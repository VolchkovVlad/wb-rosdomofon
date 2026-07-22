const http = require('http');
const https = require('https');
const axios = require('axios');

class HLSProxy {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 8099;

    /*
      camId => {
        rdvaUri,
        getAccessToken
      }
    */
    this.cameras = new Map();

    this.server = null;
    this.httpsAgent = this.createHttpsAgent();
  }

  createHttpsAgent() {
    return new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 15000,
      maxSockets: 32,
      maxFreeSockets: 8
    });
  }

  addCamera(camId, rdvaUri, getAccessToken) {
    if (camId === undefined || camId === null) {
      throw new Error('camId is required');
    }

    if (!rdvaUri) {
      throw new Error(`rdvaUri is required for camera ${camId}`);
    }

    if (typeof getAccessToken !== 'function') {
      throw new Error(
        `getAccessToken must be a function for camera ${camId}`
      );
    }

    const normalizedCamId = String(camId);

    this.cameras.set(normalizedCamId, {
      rdvaUri: String(rdvaUri),
      getAccessToken
    });

    console.log(
      `[HLS Proxy] Камера ${normalizedCamId} зарегистрирована: ${rdvaUri}`
    );
  }

  removeCamera(camId) {
    this.cameras.delete(String(camId));
  }

  start() {
    if (this.server) {
      return;
    }

    /*
      После вызова stop() старый HTTPS-agent уничтожается.
      При повторном запуске создаём новый.
    */
    if (!this.httpsAgent) {
      this.httpsAgent = this.createHttpsAgent();
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch(error => {
        console.error(
          '[HLS Proxy] Необработанная ошибка:',
          error
        );

        if (!res.headersSent) {
          res.writeHead(500, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store'
          });
        }

        res.end('Internal proxy error');
      });
    });

    this.server.on('error', error => {
      console.error(
        '[HLS Proxy] Ошибка HTTP-сервера:',
        error
      );
    });

    this.server.listen(this.port, this.host, () => {
      console.log(
        `[HLS Proxy] Запущен на http://${this.host}:${this.port}`
      );
    });
  }

  async stop() {
    const server = this.server;
    this.server = null;

    if (server) {
      await new Promise((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    if (this.httpsAgent) {
      this.httpsAgent.destroy();
      this.httpsAgent = null;
    }
  }

  async handleRequest(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      });

      res.end('Method not allowed');
      return;
    }

    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host || '127.0.0.1'}`
    );

    /*
      Короткая ссылка на основной плейлист:

      /hls/41415.m3u8

      В RosDomofon она преобразуется в:

      /live/41415.m3u8
    */
    const playlistMatch = requestUrl.pathname.match(
      /^\/hls\/([^/]+)\.m3u8$/
    );

    if (playlistMatch) {
      const camId = decodeURIComponent(playlistMatch[1]);

      await this.proxyRequest({
        req,
        res,
        camId,
        remotePath: `/live/${encodeURIComponent(camId)}.m3u8`,
        search: requestUrl.search
      });

      return;
    }

    /*
      Универсальный маршрут для сегментов, ключей,
      вложенных плейлистов и других ресурсов:

      /hls/<camId>/<remotePath>
    */
    const resourceMatch = requestUrl.pathname.match(
      /^\/hls\/([^/]+)\/(.+)$/
    );

    if (resourceMatch) {
      const camId = decodeURIComponent(resourceMatch[1]);
      const remotePath = '/' + resourceMatch[2];

      await this.proxyRequest({
        req,
        res,
        camId,
        remotePath,
        search: requestUrl.search
      });

      return;
    }

    this.sendError(res, 404, 'Not found');
  }

  getCamera(camId) {
    return this.cameras.get(String(camId));
  }

  async proxyRequest(params) {
    const req = params.req;
    const res = params.res;
    const camId = String(params.camId);
    const remotePath = params.remotePath;
    const search = params.search || '';

    const camera = this.getCamera(camId);

    if (!camera) {
      this.sendError(
        res,
        404,
        `Camera ${camId} is not registered`
      );
      return;
    }

    const accessToken = camera.getAccessToken();

    if (!accessToken) {
      this.sendError(
        res,
        503,
        `Access token for camera ${camId} is unavailable`
      );
      return;
    }

    if (!this.isSafeRemotePath(remotePath)) {
      this.sendError(res, 400, 'Invalid remote path');
      return;
    }

    const remoteUrl =
      `https://s.${camera.rdvaUri}${remotePath}${search}`;

    let response;

    try {
      response = await axios({
        method: req.method,
        url: remoteUrl,

        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: req.headers.accept || '*/*',
          'User-Agent':
            req.headers['user-agent'] ||
            'wb-rosdomofon-hls-proxy'
        },

        /*
          Используем один общий HTTPS-agent.

          TCP- и TLS-соединения с сервером RosDomofon
          переиспользуются между запросами плейлиста
          и последовательных HLS-сегментов.
        */
        httpsAgent: this.httpsAgent,

        responseType: 'stream',
        timeout: 15000,
        maxRedirects: 3,
        validateStatus: () => true
      });
    } catch (error) {
      console.error(
        `[HLS Proxy] Камера ${camId}: ошибка запроса ${remotePath}:`,
        error.message
      );

      this.sendError(
        res,
        502,
        'Unable to load remote resource'
      );
      return;
    }

    if (response.status < 200 || response.status >= 300) {
      if (
        response.data &&
        typeof response.data.destroy === 'function'
      ) {
        response.data.destroy();
      }

      console.error(
        `[HLS Proxy] Камера ${camId}: ${remotePath} вернул ${response.status}`
      );

      this.sendError(
        res,
        response.status,
        `Remote server returned ${response.status}`
      );
      return;
    }

    if (this.isPlaylist(remotePath, response.headers)) {
      await this.proxyPlaylistResponse({
        response,
        res,
        camId,
        remoteUrl,
        requestMethod: req.method
      });

      return;
    }

    this.proxyStreamResponse({
      response,
      res,
      requestMethod: req.method
    });
  }

  async proxyPlaylistResponse(params) {
    const response = params.response;
    const res = params.res;
    const camId = params.camId;
    const remoteUrl = params.remoteUrl;
    const requestMethod = params.requestMethod;

    let playlist;

    try {
      playlist = await this.readStreamAsText(response.data);
    } catch (error) {
      console.error(
        `[HLS Proxy] Камера ${camId}: ошибка чтения плейлиста:`,
        error.message
      );

      this.sendError(
        res,
        502,
        'Unable to read remote playlist'
      );
      return;
    }

    const rewrittenPlaylist = this.rewritePlaylist(
      playlist,
      camId,
      remoteUrl
    );

    const body = Buffer.from(rewrittenPlaylist, 'utf8');

    const headers = {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': body.length,
      'Cache-Control': 'no-store, no-cache',
      'Access-Control-Allow-Origin': '*'
    };

    res.writeHead(response.status, headers);

    if (requestMethod === 'HEAD') {
      res.end();
      return;
    }

    res.end(body);
  }

  proxyStreamResponse(params) {
    const response = params.response;
    const res = params.res;
    const requestMethod = params.requestMethod;

    const headers = {};

    const allowedHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified'
    ];

    allowedHeaders.forEach(headerName => {
      const value = response.headers[headerName];

      if (value !== undefined) {
        headers[headerName] = value;
      }
    });

    headers['cache-control'] = 'no-store';
    headers['access-control-allow-origin'] = '*';

    res.writeHead(response.status, headers);

    if (requestMethod === 'HEAD') {
      if (
        response.data &&
        typeof response.data.destroy === 'function'
      ) {
        response.data.destroy();
      }

      res.end();
      return;
    }

    response.data.on('error', error => {
      console.error(
        '[HLS Proxy] Ошибка передачи удалённого ресурса:',
        error.message
      );

      res.destroy(error);
    });

    res.on('close', () => {
      if (
        !res.writableEnded &&
        response.data &&
        typeof response.data.destroy === 'function'
      ) {
        response.data.destroy();
      }
    });

    /*
      Сегменты передаются сразу по мере получения.
      Полная загрузка сегмента в память не выполняется.
    */
    response.data.pipe(res);
  }

  rewritePlaylist(playlist, camId, playlistRemoteUrl) {
    return String(playlist)
      .split(/\r?\n/)
      .map(line => {
        const trimmed = line.trim();

        if (!trimmed) {
          return line;
        }

        /*
          Обычная строка сегмента или вложенного плейлиста:

          segment.ts
          /dllive/41415/segment.ts
          https://server/path/segment.ts
        */
        if (!trimmed.startsWith('#')) {
          return this.createProxyUrl(
            camId,
            trimmed,
            playlistRemoteUrl
          );
        }

        /*
          HLS-теги могут содержать URI внутри атрибута:

          #EXT-X-KEY:METHOD=AES-128,URI="key.bin"
          #EXT-X-MAP:URI="init.mp4"
          #EXT-X-MEDIA:...,URI="audio.m3u8"
        */
        return line.replace(
          /URI="([^"]+)"/g,
          (fullMatch, uri) => {
            const proxyUrl = this.createProxyUrl(
              camId,
              uri,
              playlistRemoteUrl
            );

            return `URI="${proxyUrl}"`;
          }
        );
      })
      .join('\n');
  }

  createProxyUrl(camId, resourceUri, playlistRemoteUrl) {
    let remoteResourceUrl;

    try {
      remoteResourceUrl = new URL(
        resourceUri,
        playlistRemoteUrl
      );
    } catch (error) {
      console.error(
        '[HLS Proxy] Некорректный URI в плейлисте:',
        resourceUri
      );

      return resourceUri;
    }

    const encodedPath = remoteResourceUrl.pathname
      .split('/')
      .map(pathPart => encodeURIComponent(
        decodeURIComponent(pathPart)
      ))
      .join('/');

    return (
      `/hls/${encodeURIComponent(camId)}` +
      `${encodedPath}` +
      `${remoteResourceUrl.search}`
    );
  }

  isPlaylist(remotePath, headers) {
    const contentType = String(
      headers['content-type'] || ''
    ).toLowerCase();

    return (
      remotePath.toLowerCase().endsWith('.m3u8') ||
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegurl')
    );
  }

  isSafeRemotePath(remotePath) {
    if (typeof remotePath !== 'string') {
      return false;
    }

    if (!remotePath.startsWith('/')) {
      return false;
    }

    if (remotePath.includes('\0')) {
      return false;
    }

    /*
      Запрещаем выход через ../
    */
    const normalizedParts = remotePath.split('/');

    return !normalizedParts.some(part => {
      try {
        return decodeURIComponent(part) === '..';
      } catch (error) {
        return true;
      }
    });
  }

  readStreamAsText(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];

      stream.on('data', chunk => {
        chunks.push(Buffer.from(chunk));
      });

      stream.on('end', () => {
        resolve(
          Buffer.concat(chunks).toString('utf8')
        );
      });

      stream.on('error', reject);
    });
  }

  sendError(res, statusCode, message) {
    if (res.headersSent) {
      res.end();
      return;
    }

    res.writeHead(statusCode, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    res.end(message);
  }
}

module.exports = HLSProxy;