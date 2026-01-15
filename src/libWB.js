const MQTT  = require('mqtt');      // Подключаем библиотеку для работы с MQTT
const CFG   = require('./libCFG');  // Подключаем библиотеку для конфигураций


class WB { // Основной класс WB
  constructor() {
    const cfgInstance = new CFG();
    this.cfg = cfgInstance.read_rosdomofon_config(); // mqtt_ip и т.п.
    this.client = null; // MQTT клиент
    this.deviceMap = {}; // Локальная карта устройств
    this.valueCache = {}; // Кэш get-значений
    this.subscribers = {}; // Колбэки подписчиков
    this.isReady = false; // Флаг инициализации
  }

  publish(topic, value, opts = { retain: true, qos: 2 }) {
    if (!this.client) throw new Error('[libWB] ❌ MQTT клиент не инициализирован');
    this.client.publish(topic, String(value), opts);
  }

  publishAsync(topic, value, opts = { retain: true, qos: 2 }) {
    if (!this.client) {
      return Promise.reject(new Error('[libWB] ❌ MQTT клиент не инициализирован'));
    }

    return new Promise((resolve, reject) => {
      this.client.publish(topic, String(value), opts, err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }


  get dev() {
    // Обёртка для чтения и записи (через /on)
    return new Proxy({}, {
      get: (_, key) => this.valueCache[key],
      set: (_, key, val) => {
        const [devName, cellName] = key.split("/");
        this.publish(`/devices/${devName}/controls/${cellName}/on`, val);
        return true;
      }
    });
  }

  get devStatus() {
    // Обёртка для принудительной записи в get-топик
    return new Proxy({}, {
      get: (_, key) => this.valueCache[key],
      set: (_, key, val) => {
        this.valueCache[key] = val;
        const [devName, cellName] = key.split("/");
        this.publish(`/devices/${devName}/controls/${cellName}`, val);
        return true;
      }
    });
  }

  async connect() {
    const url = `mqtt://${this.cfg.mqttIP || 'localhost'}:${this.cfg.mqttPort || 1883}`;
    this.client = MQTT.connect(url, {
      username: this.cfg.mqttLogin || undefined,
      password: this.cfg.mqttPassword || undefined,
      clientId: 'wb-rosdomofon' + process.pid,
      reconnectPeriod: 2000
    });

    this.client.on('connect', () => {
      this.client.subscribe('/devices/+/controls/#')
    });

    this.client.on('message', (topic, message, packet) => {
      const value = message.toString();

      const match = topic.match(/^\/devices\/(.+?)\/controls\/(.+?)(\/on)?$/);
      if (!match) return;

      const [, device, control, onPartRaw] = match;
      const onPart = !!onPartRaw;

      const baseKey = `${device}/${control}`;
      const fullKey = onPart ? `${baseKey}/on` : baseKey;

      const isDriverMode =
        !!this.deviceMap[device]?.controls?.[control]?.meta?.driverMode;

      // всегда обновляем cache
      if (!onPart || (onPart && !isDriverMode)) {
        this.valueCache[baseKey] = value;
      }

      // 🚫 retained ≠ событие
      if (packet?.retain) {
        return;
      }

      // 🔔 только живые события
      if (!onPart && this.subscribers[baseKey]) {
        this.subscribers[baseKey].forEach(cb => cb(value));
      }

      if (onPart && this.subscribers[fullKey]) {
        this.subscribers[fullKey].forEach(cb => cb(value));
      }

      // отражение команды в состояние
      if (onPart && !isDriverMode) {
        this.publish(`/devices/${device}/controls/${control}`, value);
      }
    });


  }

  subscribe     (deviceName, controlName, callback) {
    const isOn = controlName.endsWith('/on');
    const cleanControl = isOn ? controlName.slice(0, -3) : controlName;

    const baseKey = `${deviceName}/${cleanControl}`;
    const onKey   = `${baseKey}/on`;

    if (isOn) {
      // подписка ТОЛЬКО на /on
      if (!this.subscribers[onKey]) this.subscribers[onKey] = [];
      this.subscribers[onKey].push(callback);

      this.client.subscribe(`/devices/${deviceName}/controls/${cleanControl}/on`);
    } else {
      // подписка ТОЛЬКО на base
      if (!this.subscribers[baseKey]) this.subscribers[baseKey] = [];
      this.subscribers[baseKey].push(callback);

      this.client.subscribe(`/devices/${deviceName}/controls/${cleanControl}`);
    }
  }

  createDevice  (deviceName, meta) {
    const metaTopic = `/devices/${deviceName}/meta`;
    this.publish(metaTopic, JSON.stringify(meta));
    this.deviceMap[deviceName] = { controls: {}, meta };
  }

  createControl (deviceName, controlName, meta) {
    const metaTopic = `/devices/${deviceName}/controls/${controlName}/meta`;
    this.publish(metaTopic, JSON.stringify(meta));

    // Публикация доп. ключей
    Object.entries(meta).forEach(([k, v]) => {
      if (typeof v !== 'object') {
        this.publish(`${metaTopic}/${k}`, v);
      }
    });

    if (!this.deviceMap[deviceName]) this.deviceMap[deviceName] = { controls: {} };
    if (!this.deviceMap[deviceName].controls) this.deviceMap[deviceName].controls = {};
    this.deviceMap[deviceName].controls[controlName] = { meta };
  }

  // Удаление контроля и всех его мета-данных
  async removeControl (deviceName, controlName) {
    const base = `/devices/${deviceName}/controls/${controlName}`;
    const suffixes = [
      '',
      '/meta',
      '/meta/type',
      '/meta/units',
      '/meta/max',
      '/meta/min',
      '/meta/order',
      '/meta/readonly',
      '/meta/enum',
      '/meta/precision'
    ];

    await Promise.all(
      suffixes.map(sfx =>
        this.publishAsync(`${base}${sfx}`, '')
      )
    );

    if (this.deviceMap[deviceName]) {
      delete this.deviceMap[deviceName].controls[controlName];
    }
  }
  // Удаление устройства и всех его контролов
  async removeDevice  (deviceName) {
    const dev = this.deviceMap[deviceName];
    if (!dev) return;

    const controls = Object.keys(dev.controls || {});

    await Promise.all(
      controls.map(ctrl =>
        this.removeControl(deviceName, ctrl)
      )
    );

    await this.publishAsync(`/devices/${deviceName}/meta`, '');
    delete this.deviceMap[deviceName];
  }
  // Удаление всех устройств
  async removeDevices () {
    const devices = Object.keys(this.deviceMap);

    await Promise.all(
      devices.map(dev =>
        this.removeDevice(dev)
      )
    );
  }

  metaControl({ deviceName, controlName, meta_topic, value }) {
    if (!deviceName) throw new Error('[libWB] ❌ metaControl: не указано deviceName');

    if (!controlName) {
      const base = `/devices/${deviceName}/meta`;
      if (!meta_topic && value === undefined) {
        return this.deviceMap[deviceName]?.meta || {};
      }
      if (meta_topic && value === undefined) {
        return this.deviceMap[deviceName]?.meta?.[meta_topic];
      }
      if (meta_topic && value !== undefined) {
        if (!this.deviceMap[deviceName]) this.deviceMap[deviceName] = { meta: {} };
        if (!this.deviceMap[deviceName].meta) this.deviceMap[deviceName].meta = {};
        this.deviceMap[deviceName].meta[meta_topic] = value;
        this.publish(`${base}/${meta_topic}`, value);
        return;
      }
    }

    if (controlName) {
      const base = `/devices/${deviceName}/controls/${controlName}/meta`;
      if (!meta_topic && value === undefined) {
        return this.deviceMap[deviceName]?.controls?.[controlName]?.meta || {};
      }
      if (meta_topic && value === undefined) {
        return this.deviceMap[deviceName]?.controls?.[controlName]?.meta?.[meta_topic];
      }
      if (meta_topic && value !== undefined) {
        if (!this.deviceMap[deviceName]) this.deviceMap[deviceName] = { controls: {} };
        if (!this.deviceMap[deviceName].controls) this.deviceMap[deviceName].controls = {};
        if (!this.deviceMap[deviceName].controls[controlName]) this.deviceMap[deviceName].controls[controlName] = {};
        if (!this.deviceMap[deviceName].controls[controlName].meta) this.deviceMap[deviceName].controls[controlName].meta = {};
        this.deviceMap[deviceName].controls[controlName].meta[meta_topic] = value;
        this.publish(`${base}/${meta_topic}`, value);
        return;
      }
      if ((meta_topic === undefined) && (value !== undefined)) {
        return this.publish(`${base}`, JSON.stringify(value));
      }
    }
  }
}

module.exports = WB;