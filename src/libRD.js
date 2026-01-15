const axios = require('axios');  // HTTP клиент для запросов
const apiBaseUrl = 'https://rdba.rosdomofon.com';

class RD {

  async send_sms(phone) {
    try {
        const url = `${apiBaseUrl}/abonents-service/api/v1/abonents/${phone}/sms`;
        const headers = {
          'Content-Type': 'application/json'
        };

        const res = await axios.post(url, {}, { headers });
        return res;
    } catch (e) {
        //const errorData = e.response?.data || { error: e.message };
        return e;
    }
  }

  async send_code(phone, code) {
    try {
      const url = `${apiBaseUrl}/authserver-service/oauth/token`;
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
      };

      const params = new URLSearchParams();
      params.append('grant_type', 'mobile');
      params.append('client_id', 'abonent');
      params.append('phone', phone);
      params.append('sms_code', code);
      params.append('company', '');

      const res = await axios.post(url, params.toString(), { headers });
      
      return res;
    } catch (e) {
      
      return null;
    }
  }

  async get_access_token(refresh_token, rawFlag) {
    try {
      const url = `${apiBaseUrl}/authserver-service/oauth/token`;
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
      };

      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('client_id', 'abonent');
      params.append('refresh_token', refresh_token);

      const res = await axios.post(url, params.toString(), { headers });
      if(rawFlag){
        return res.data;
      }else{
        return res.data.access_token;
      }
    } catch (e) {
      
      return null;
    }
  }

  async get_settings(access_token) {
    try {
      const url = `${apiBaseUrl}/abonents-service/api/v1/abonents/settings`;
      const headers = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      };

      const res = await axios.get(url, { headers });
      return res.data;                 // { callsMuted: false, chatsMuted: true }
    } catch (e) {
      console.error(
        '[RD] get_settings error:',
        e?.response?.status,
        e?.response?.data || e.message
      );
      return null;
    }
  }

  async set_settings(access_token, setting) {
    try {
      const url = `${apiBaseUrl}/abonents-service/api/v1/abonents/settings`;
      const headers = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      const res = await axios.patch(url, setting, { headers });
      return res.data;                // актуальные настройки
    } catch (e) {
      console.error(
        '[RD] set_setting error:',
        e?.response?.status,
        e?.response?.data || e.message
      );
      return null;
    }
  }

  async get_adapters(access_token, rawFlag) {
    try {
      const url = `${apiBaseUrl}/abonents-service/api/v2/abonents/keys`;
      const headers = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      };

      const res = await axios.get(url, { headers });
      if(rawFlag){
        return res.data;
      }else{
        let devices = [];
        res.data.forEach(device => {
          //Не понятно как приходят данные если нет корпуса, а только дом, поэтому пока закоментировал: к${device.address.house.housing}
          let comment = `г. ${device.address.city} ул. ${device.address.street.name} д. ${device.address.house.number} подъезд №${device.address.entrance.number}`
          devices.push({
            enable: "🟢",
            comment: comment,
            type: device.type.toString(),
            adapterId: device.adapterId,
            relay: device.relay.toString()
          })
        });

        return devices
      }

      }catch (e) {
      console.error('[RD] get_devices error:',
        e?.response?.status,
        e?.response?.data || e.message
      );
      return null;
    }

  }

  async get_cameras(access_token, rawFlag){
     try {
      const url = `${apiBaseUrl}/abonents-service/api/v2/abonents/cameras`;
      const headers = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      };

      const res = await axios.get(url, { headers });
      if(rawFlag){
        return res.data;
      }else{
        let cameras = [];
        res.data.forEach(cam => {
          let comment = `г. ${cam.address.city} ул. ${cam.address.street.name} д. ${cam.address.house.number} подъезд №${cam.address.entrance.number}`
          cameras.push({
            rdaUid: cam.rdaUid,
            comment: comment,
            id: cam.id,
          })
        });

        return cameras
      }
    
      }catch (e) {
      console.error('[RD] get_cameras error:',
        e?.response?.status,
        e?.response?.data || e.message
      );
      return null;
    }

  }

  async get_rtsp(access_token, camId, rawFlag){
    try {
      const url = `${apiBaseUrl}/cameras-service/api/v1/cameras/${camId}`;
      const headers = {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      };

      const res = await axios.get(url, { headers });
      if(rawFlag){
        return res.data;
      }else{
        let data = res.data

        if (!data.uri || !data.user || !data.password) return null;

        const encodedUser = encodeURIComponent(data.user);
        const encodedPass = encodeURIComponent(data.password);

        const [scheme, rest] = data.uri.split("://");
        if (!rest) return null;

        return `${scheme}://${encodedUser}:${encodedPass}@${rest}`;
      }

      }catch (e) {
      console.error('[RD] get_rtsp error:',
        e?.response?.status,
        e?.response?.data || e.message
      );
      return null;
    }
  }

  async open_door(access_token, adapterId, relay) {
    try {
      const url = `${apiBaseUrl}/rdas-service/api/v1/rdas/${adapterId}/activate_key`;
      const headers = {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      };

      const body = {
        rele: relay
      };

      const res = await axios.post(url, body, { headers });
      return res.data;
    } catch (e) {
      console.error(
        '[RD] open_door error:',
        e?.response?.status,
        e?.response?.data || e.message
      );
      return null;
    }
  }

}

module.exports = RD;