const WB  = require('./libWB');   // Подключаем библиотеку для работы с WirenBoard
const RD  = require('./libRD');   // Подключаем библиотеку для работы c РосДомофоном
const CFG = require('./libCFG');  // Подключаем библиотеку для работы с Конфигурационными файлами

const wb = new WB();
const rd = new RD();
const cfg = new CFG();
let cfg_rosdomofon;  // Глобальная переменная для хранения конфигурации драйвера РосДомофон
let isConnected = false;

function waitForConnect(wb, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('MQTT connect timeout'));
    }, timeoutMs);

    function onConnect() {
      cleanup();
      isConnected = true;
      resolve();
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      clearTimeout(timer);
      wb.client?.off('connect', onConnect);
      wb.client?.off('error', onError);
    }

    wb.client?.once('connect', onConnect);
    wb.client?.once('error', onError);
  });
}

(async () => {
  try {
    wb.connect(); // запускаем попытку
    await waitForConnect(wb, 5000); // ждём ФАКТИЧЕСКОЕ подключение

    read_wb_rosdomofon_cfg(); // ← только если реально подключились
  } catch (e) {
    console.error('[wb-rosdomofon] ❌ MQTT не подключился:', e.message);
    process.exit(1); // systemd перезапустит
  }
})();

/////////////////////////////////////////////////////
// Функция чтения конфигурации драйвера RosDomofon //
/////////////////////////////////////////////////////

function read_wb_rosdomofon_cfg() {
  cfg_rosdomofon = cfg.read_rosdomofon_config()
  if(!cfg_rosdomofon.enableDriver) return    // Если драйвер не включен, выходим из функции
  const users = cfg_rosdomofon.users
  users.forEach(user => {
    if(user.token == ""){         // Если токен пустой: 
      create_user(user)           // Подключаем нового пользователя
    }else{                        // Если токен есть:      
      loading_user(user)          // Загружаем данные пользователя   
    }
  });
}

/////////////////////////////////////////////////////////////////////////
// Функция входа в учетную запись РосДомофона -> созданяи пользователя //
/////////////////////////////////////////////////////////////////////////

function create_user(user_params) {
  if(user_params.enable != "🟢") return               // Если пользователь не активен, выходим из функции
  const userID = user_params.id

  // Создание устройства и контролов в WirenBoard для данного пользователя
  const deviceName = `RosDomfon_user_${userID}`
  
  wb.createDevice(deviceName, {
    driver: "wb-rosdomofon",
    title: {ru: `Пользователь РосДомофон №${userID}`, en: `RosDomofon User №${userID}`},
  })
  wb.createControl(deviceName, "phone_number", {
    title: {ru: "Номер телефона", en:  "Phone Number"},
    type: "text",
    readonly: false,
    order: 0,
  })
  wb.createControl(deviceName, "send_sms", {
    title: {ru: "Отправить SMS", en:  "Send SMS"},
    type: "pushbutton",
    readonly: false,
    order: 1,
  })
  wb.createControl(deviceName, "code_in_sms", {
    title: {ru: "Код из SMS", en:  "Cose from SMS"},
    type: "text",
    driverMode: false,
    readonly: false,
    order: 2,
  })
  wb.createControl(deviceName, "send_code", {
    title: {ru: "Отправить код", en:  "Send code"},
    type: "pushbutton",
    readonly: false,
    order: 3,
  })
  
  function normalizePhone(phone) {
    if (!phone) return phone;

    // убираем пробелы, скобки, дефисы
    let p = String(phone).replace(/[^\d+]/g, '');

    // 8XXXXXXXXXX → +7XXXXXXXXXX
    if (/^8\d{10}$/.test(p)) {
      return {status: "change", payload: '+7' + p.slice(1)}
    }

    // уже нормальный российский номер
    if (/^\+7\d{10}$/.test(p)) {
      return {status: "notchange"};
    }

    return {status: "error"}
  }


  wb.subscribe(deviceName, "send_sms/on", async () => {
    const phone = wb.dev[`${deviceName}/phone_number`];
    const result = await rd.send_sms(phone);

    switch (result.status) {
      case 200:
        resending_сountdown(deviceName, true)
      break;
      case 429:
        resending_сountdown(deviceName, false, result.status)
      break;
      default:
        resending_сountdown(deviceName, false, result.status)
        console.log(`[wb-rosdomofon] Отправка SMS не выполненна из-за ошибки:`, result);
      break;
    }
    
  });

  wb.subscribe(deviceName, "phone_number", (newValue) => {
   let phone_number = normalizePhone(newValue)
   switch(phone_number.status){
    case "change":
      wb.dev[`${deviceName}/phone_number`] = phone_number.payload
      wb.metaControl({
        deviceName: deviceName, 
        controlName: "phone_number", 
        value: {
          title: {
            ru: "Номер телефона", 
            en: "Phone Number"
          }, 
          type: "text", 
          readonly: false, 
          error: "",
          order: 0
        } 
      })
    break
    case "notchange":
      wb.metaControl({
        deviceName: deviceName, 
        controlName: "phone_number", 
        value: {
          title: {
            ru: "Номер телефона", 
            en: "Phone Number"
          }, 
          type: "text", 
          readonly: false, 
          error: "",
          order: 0
        } 
      })
    break
    case "error":
      wb.metaControl({
        deviceName: deviceName, 
        controlName: "phone_number", 
        value: {
          title: {
            ru: "Номер телефона", 
            en: "Phone Number"
          }, 
          type: "text", 
          readonly: false, 
          error: "r",
          order: 0
        } 
      })
    break
   }
  });

  wb.subscribe(deviceName, "send_code/on", async () => {
    const result = await rd.send_code(wb.dev[`${deviceName}/phone_number`], wb.dev[`${deviceName}/code_in_sms`])
    if(result == null){
      wb.metaControl({
        deviceName: deviceName, 
        controlName: "code_in_sms", 
        value: {
          title: {ru: "Код из SMS", en: "Cose from SMS"},
          type: "text", 
          readonly: false, 
          error: "r",
          order: 2
        } 
      })
    }else{
      wb.metaControl({
        deviceName: deviceName, 
        controlName: "code_in_sms", 
        value: {
          title: {ru: "Код из SMS", en: "Cose from SMS"},
          type: "text", 
          readonly: false, 
          error: "",
          order: 2
        } 
      })

      switch (result.status) {
        case 200:
           wb.metaControl({
            deviceName: deviceName, 
            controlName: "send_code", 
            value: {
              title: {ru: "✅ Авторизация пройдена", en: "✅ Authorization completed"},
              type: "pushbutton", 
              readonly: true, 
              order: 3
            } 
          })
          clearInterval(resending_сountdown_interval)
          wb.removeControl(deviceName, "phone_number")
          wb.removeControl(deviceName, "send_sms")
          wb.removeControl(deviceName, "code_in_sms")
          wb.removeControl(deviceName, "send_code")

          let user = result.data;

          let user_object = {
            id: userID,
            enable: "🟢",
            comment: "",
            number: user.phone,
            token: user.refresh_token,
            listDevices: [], // ✅ теперь здесь итоговый массив
          };
          loading_user(user_object);
        break;
        default:
          console.log(`[wb-rosdomofon] Ошибка при получении кода подтверждения:`, result);
          wb.metaControl({
            deviceName: deviceName, 
            controlName: "send_code", 
            value: {
              title: {ru: "❌ Авторизация не пройдена", en: "❌ Authorization not completed"},
              type: "pushbutton", 
              readonly: false, 
              order: 3
            } 
          })
        break;
      }
    }
  });

  let resending_сountdown_interval = null
  function resending_сountdown(deviceName, sending, errorCode) {
    let countdown = 60
    let ruTitle = sending ? "✅ SMS | Повтор через " : `❌ SMS | Код:  ${errorCode} | Повтор через `
    let enTitle = sending ? "✅ SMS | Repeat for " : `❌ SMS | Code:  ${errorCode} | Repeat for `

    if(resending_сountdown_interval != null) {  //Если интервал уже запущен, выходим
      return            
    }

    //// Блокировка ввода номера на время обратного отсчета
    wb.metaControl({
      deviceName: deviceName, 
      controlName: "phone_number", 
      value: {
        title: {
          ru: "Номер телефона", 
          en: "Phone Number"
        }, 
        type: "text", 
        readonly: true, 
        order: 0
      } 
    })
    //// Блокировка кнопки отправки SMS на время обратного отсчета
    publushMetacountdown(countdown)

    resending_сountdown_interval = setInterval(() => {
      if(countdown <= 1){
        clearInterval(resending_сountdown_interval)
        wb.metaControl({
          deviceName: deviceName, 
          controlName: "send_sms", 
          value: {
            title: {
              ru: "Отправить SMS", 
              en: "Send SMS"
            }, 
            type: "pushbutton", 
            readonly: false, 
            order: 1
          } 
        })
        wb.metaControl({
          deviceName: deviceName, 
          controlName: "phone_number", 
          value: {
            title: {
              ru: "Номер телефона", 
              en: "Phone Number"
            }, 
            type: "text", 
            readonly: false, 
            order: 0
          } 
        })
        resending_сountdown_interval = null
        return
      }else{
        countdown -= 1
        publushMetacountdown(countdown)
      }
    }, 1000); 

    function publushMetacountdown(countdown) {
      wb.metaControl({
          deviceName: deviceName, 
          controlName: "send_sms", 
          value: {
            title: {
              ru: ruTitle + `${countdown} сек.`,
              en: enTitle + `${countdown} sec.`
            }, 
            type: "pushbutton", 
            readonly: true, 
            order: 1
          } 
        })
    }
  }
}

///////////////////////////////////////////////////////////////
// Функция загрузки пользователя в систему с его параметрами //
///////////////////////////////////////////////////////////////

async function loading_user(user_params) {
  if(user_params.enable != "🟢") return               // Если пользователь не активен, выходим из функции
  const ID = user_params.id                     // ID пользователя
  const DEVICE_NAME = `RosDomfon_user_${ID}`    // Уникальное имя устройства в WirenBoard
  const REFREAH_TOKEN = user_params.token       // Токен обновления доступа
  let list_device = user_params.listDevices     // Список устройств пользователя (адаптеров и камер)
  let access_token;                             // Токен доступа к API
  let refresh_timer;                            // Таймер для обновления токена доступа
  let expires_in;                               // Время жизни токена доступа
  let settings = {}                             // Настройки пользователя (заглушить звонки и чаты)

  async function refresh_access_token() {
    const rawGetAccessToken = await rd.get_access_token(REFREAH_TOKEN, true);
    if (!rawGetAccessToken || !rawGetAccessToken.access_token || !rawGetAccessToken.expires_in) {
      console.error(`[wb-rosdomofon] Пользователь №${user_params.id} | Ошибка получения access token, попробую через минуту`);
      refresh_timer = setTimeout(refresh_access_token, 60 * 1000);
      return;
    }

    access_token = rawGetAccessToken.access_token;
    expires_in = rawGetAccessToken.expires_in;
    
    wb.dev[`${DEVICE_NAME}/access_token`] = access_token                                  // Записываем в контрол токен доступа пользователя
    wb.dev[`${DEVICE_NAME}/token_updated`] = `${new Date().toLocaleTimeString('ru-RU', {  // Записываем в контрол время обновления токена
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).replace(',', ' |')}`;

    refresh_timer = setTimeout(refresh_access_token,(expires_in - 300) * 1000);
  }

  await refresh_access_token();                                                          // Вызываем функцию которая будет обновлять нам токен доступа

  async function synchronization_user_info() {                                           // Функция для синхронизации параметров пользователя
    synchronization = check_change_devices(await get_devices(access_token), list_device) // Проверяем есть ли разница между свежим списком устройств и списком в конфиге

    const userIndex = cfg_rosdomofon.users.findIndex(                                    // Получаем index пользователя в списке пользователей
      user => user.id === user_params.id
    );

    if (userIndex !== -1) {                                                              //Если он есть (Просто на всякий случай проверка)
      if (synchronization.changed || cfg_rosdomofon.users[userIndex].token == "") {      //Если были изменения в устройствах, или токен был пустым (новый пользователь), то записываем в файл параметры пользователя
        user_params.listDevices = synchronization.list_device;                           //Актуальный список устройтсв записываем в параметры пользователя (Перед записью в конфиг)
        cfg_rosdomofon.users[userIndex] = {                                              //Сама запись в обьект конфигурационного файла
          ...cfg_rosdomofon.users[userIndex],
          ...user_params
        };
        cfg.write_rosdomofon_config(undefined, cfg_rosdomofon)                           //Вызываем функцию которая запишет изменения в файл
      }
    } 
  }

  await synchronization_user_info()                                                      //На всякий случай проверяем перед дальнейшей загрузкой что у нас в кофиге и в реальности
  ///////////////////////////////////////////////////////////////////////////
  // Создание устройства и контролов в WirenBoard для данного пользователя //
  ///////////////////////////////////////////////////////////////////////////

  wb.createDevice(DEVICE_NAME, {
    driver: "wb-rosdomofon",
    title: {ru: `Пользователь РосДомофон №${ID}`, en: `RosDomofon User №${ID}`},
  })
  wb.createControl(DEVICE_NAME, "device_count", {
    title: {ru: "Количество устройств", en:  "Device count"},
    type: "value",
    readonly: true,
    units: "шт.",
    value: list_device.length,
    order: 1,
  })
  wb.createControl(DEVICE_NAME, "read_settings", {
    title: {ru: "Прочитать настройки пользователя", en:  "Read user settings"},
    type: "pushbutton",
    readonly: false,
    order: 10,
  })
  wb.createControl(DEVICE_NAME, "calls_muted", {
    title: {ru: "Настройки: Заглушить звонки", en: "Settings: Calls muted"},
    type: "switch",
    readonly: false,
    order: 11,
  })
  wb.createControl(DEVICE_NAME, "chats_muted", {
    title: {ru: "Настройки: Заглушить чаты", en:  "Settings: Chats muted"},
    type: "switch",
    readonly: false,
    order: 12,
  })
  wb.createControl(DEVICE_NAME, "token_updated", {
    title: {ru: "Токен обновлен", en:  "Token updated"},
    type: "text",
    readonly: true,
    order: 100,
  })
  wb.createControl(DEVICE_NAME, "access_token", {
    title: {ru: "Токен доступа", en:  "Access token"},
    type: "text",
    readonly: true,
    order: 101,
  })

  wb.dev[`${DEVICE_NAME}/device_count`] = list_device.length        // Записываем в контрол количество устройств пользователя
  wb.dev[`${DEVICE_NAME}/access_token`] = access_token              // Записываем в контрол токен доступа пользователя
  
  async function user_settings(current_settings) {                  //Функция получения и установки настроек пользователя
    if(current_settings == undefined){                              //Если параметр функции false, то просто получаем настройки
      settings = await rd.get_settings(access_token)
    }else{
      settings = current_settings
    }
    wb.devStatus[`${DEVICE_NAME}/calls_muted`] = settings.callsMuted == true? "1":"0"
    wb.devStatus[`${DEVICE_NAME}/chats_muted`] = settings.chatsMuted == true? "1":"0"
  }
  
  user_settings()                                                   //При загрузке драйвера получаем настройки пользователя

  wb.subscribe(DEVICE_NAME, "read_settings/on", async () => {       //Подписываемся на кнопку "Прочитать настройки"
      user_settings()
  });

  wb.subscribe(DEVICE_NAME, "calls_muted/on", async (newValue) => { //Подписываемся на изменение состояния заглушки звонков
    settings.callsMuted = newValue == "1"? true:false
    settings = await rd.set_settings(access_token, settings)
    user_settings(settings)
  });

  wb.subscribe(DEVICE_NAME, "chats_muted/on", async (newValue) => { //Подписываемся на изменение состояния заглушки чатов
    settings.chatsMuted = newValue== "1"? true:false
    settings = await rd.set_settings(access_token, settings)
    user_settings(settings)
  });

  list_device.forEach(device => {                                   //Создаем устройства пользователя
    create_device(device)
  });

  async function create_device(device_params) {
    if(device_params.enable != "🟢") return       //Если устройтсво выключено, не создаем его
    const ADAPTER_ID = device_params.adapterId    //ID адаптера
    const ADAPTER_TYPE = device_params.type       //Тип адаптера
    const ADAPTER_TYPES = {                       //Словарь типов адаптеров
      1: {
        title: {ru: "Замок", en: "lock"},
        title_status: {ru: "Статус замка", en: "lock status"},
        enum_state: {
          0: {ru: "Открыт", en: "Opened"},
          1: {ru: "Закрыт", en: "Closed"},
          2: {ru: "Зажат", en: "Jammed"},
          3: {ru: "Неизвестен", en: "Unknown"},
        }
      },
      2: {
        title: {ru: "Шлагбаум", en: "Barrier"},
        title_status: {ru: "Статус шлагбаума", en: "Barrier status"},
        enum_state: {
          0: {ru: "Открыт", en: "Opened"},
          1: {ru: "Закрыт", en: "Closed"},
          2: {ru: "Зажат", en: "Jammed"},
          3: {ru: "Неизвестен", en: "Unknown"},
        }
      },
      3: {
        title: {ru: "Ворота", en: "Gates"},
        title_status: {ru: "Статус ворот", en: "Gates status"},
        enum_state: {
          0: {ru: "Открыты", en: "Open"},
          1: {ru: "Закрыты", en: "Close"},
          2: {ru: "Зажаты", en: "Jammed"},
          3: {ru: "Неизвестен", en: "Unknown"},
        }
      },
      4: {
        title: {ru: "Калитка", en: "Wicket"},
        title_status: {ru: "Статус калитки", en: "Wicket status"},
        enum_state: {
          0: {ru: "Открыта", en: "Opened"},
          1: {ru: "Закрыта", en: "Closed"},
          2: {ru: "Зажата", en: "Jammed"},
          3: {ru: "Неизвестен", en: "Unknown"},
        }
      },
      5: {
        title: {ru: "Камера", en: "Camera"},
      }
    }
    
    /////////////////////
    // Создаем адаптер //
    /////////////////////
    const ADAPTER_TITLE = ADAPTER_TYPES[ADAPTER_TYPE].title || {ru: "Неизвестный тип", en: "Unknown type"}

    wb.createDevice(ADAPTER_ID, {
      driver: "wb-rosdomofon",
      title: {
        ru: `${ADAPTER_TITLE.ru} ${ADAPTER_ID}`, 
        en: `${ADAPTER_TITLE.en} ${ADAPTER_ID}`
      },
    })

    /////////////////////
    // Работа с замком //
    /////////////////////

    if(device_params.relay != undefined) {                              //Если на нашем адаптере есть реле замка
       wb.createControl(ADAPTER_ID, "lock_state", {
        title: {
          ru: ADAPTER_TYPES[ADAPTER_TYPE].title_status.ru, 
          en: ADAPTER_TYPES[ADAPTER_TYPE].title_status.en
        },
        type: "value",
        value: 1,
        readonly: true,
        enum: ADAPTER_TYPES[ADAPTER_TYPE].enum_state,
        order: 1,
      })

      wb.createControl(ADAPTER_ID, "lock", {
        title: {
          ru: `${ADAPTER_TITLE.ru}`, 
          en: `${ADAPTER_TITLE.en}`
        },
        type: "value",
        value: 1,
        enum: {
          0: {ru: "Открыть", en: "Open"},
          1: {ru: "Закрыть", en: "Close"},
        },
        readonly: false,
        order: 2,
      })

      wb.dev[ADAPTER_ID + "/lock_state"] = "1"        //Записываем в контрол статус "Закрыт"
      wb.devStatus[ADAPTER_ID + "/lock"] = "1";       //При загрузке драйвера ставим замок в закрытое состояние

      let open_timeout = null                                     //Таймаут на автоматическое закрытие двери          
      wb.subscribe(ADAPTER_ID, "lock/on", async (newValue) => {   //Подписываемся на изменение контрола замка
        if(newValue == "0"){                                      //Если новое значение замка "Открыть", то:
          let unlock_status = await rd.open_door(access_token, ADAPTER_ID, device_params.relay)                                   //Отправляем запрос на открытие двери   
        
          if(unlock_status == null){                                                                                              //Если ответ пустой, значит ошибка           
            console.log(`[wb-rosdomofon] Адаптер ${ADAPTER_ID} | Ошибка при попытке открыть дверь`);      
            wb.dev[ADAPTER_ID + "/lock_state"] = "2";                                                                             //Ставим статус замка "Зажат"
          }else if(unlock_status.activityResult == "opendoor_complete"){                                                          //Если ответ содержит успешное открытие двери
            console.log(`[wb-rosdomofon] Адаптер ${ADAPTER_ID} | Дверь успешно открыта | ID События`, unlock_status.activityId);  //Логируем успешное открытие двери с ID события
            wb.dev[ADAPTER_ID + "/lock_state"] = "0"; // Открыт                                                                   //Ставим статус замка "Открыт"

            if(open_timeout !== null){                                                                                            //Если таймаут уже был запущен, то очищаем его
              clearTimeout(open_timeout)
              open_timeout = null
            }
            open_timeout = setTimeout(() => {                                                                                     //Запускаем таймаут на автоматическое закрытие двери
              wb.dev[ADAPTER_ID + "/lock_state"] = "1";                                                                           //Ставим статус замка "Закрыт"
              wb.devStatus[ADAPTER_ID + "/lock"] = "1";                                                                           //Статус управление замком "Закрыт"
              clearTimeout(open_timeout)
              open_timeout = null
            }, 5000);                                                                                                             //Изменить статус двери на "закрыта" через 5 секунд
          }
        }
      });
    }

    //////////////////////
    // Работа с камерой //
    //////////////////////

    if(device_params.camId != undefined ) {                             //Если на нашем адаптере есть камера

      wb.createControl(ADAPTER_ID, "rtsp", {                            //Создаем контрол для RTSP ссылки
        title: {ru: "Камера", en:  "Camera"},
        type: "text",
        readonly: true,
        order: 3,
      })

      wb.dev[ADAPTER_ID + "/rtsp"] = await rd.get_rtsp(access_token, device_params.camId);   //Записываем RTSP ссылку в контрол  
    }
  
  }
}

////////////////////////////////////////////////////////////////////
// Функция получения списка устройств пользователя с учётом камер //
////////////////////////////////////////////////////////////////////

async function get_devices (access_token) {
  let user_devices = await rd.get_adapters(access_token, false);
  let user_cameras = await rd.get_cameras(access_token, false);
  let user_list_devices = [];

  // Индексируем камеры по adapterId
  const camerasByAdapter = new Map();
  user_cameras.forEach(camera => {
    camerasByAdapter.set(String(camera.rdaUid), camera);
  });

  const usedCameraAdapters = new Set();

  // 1. Обрабатываем устройства
  for (const device of user_devices) {
    const adapterId = String(device.adapterId);
    const camera = camerasByAdapter.get(adapterId);

    if (camera) {
      usedCameraAdapters.add(adapterId);

      user_list_devices.push({
        ...device,
        camId: String(camera.id),
      });
    } else {
      // если у устройства нет камеры — кладём как есть
      user_list_devices.push(device);
    }
  }

  // 2. Добавляем камеры без совпадений
  for (const camera of user_cameras) {
    const rdaUid = String(camera.rdaUid);

    if (!usedCameraAdapters.has(rdaUid)) {
      user_list_devices.push({
        enable: "🟢",
        type: "5", // Тип "Камера"
        comment: "",
        adapterId: rdaUid,
        camId: String(camera.id),
      });
    }
  } 

  return user_list_devices;
}

function check_change_devices(current_list_device, config_list_device) {
  let changed = false;                                  // Флаг для отслеживания изменений

  const configMap = new Map(
    config_list_device.map(dev => [dev.adapterId, dev])
  );

  current_list_device.forEach(newDev => {
    const adapterId = newDev.adapterId;
    if (!adapterId) return;

    const oldDev = configMap.get(adapterId);

    // === Новый adapterId ===
    if (!oldDev) {
      config_list_device.push({
        ...newDev
      });
      changed = true
      return;
    }

    // === Сравнение и обновление ===
    Object.keys(newDev).forEach(key => {
      if (key === "enable" || key === "comment") return;
      

      if (
        newDev[key] !== undefined &&
        oldDev[key] !== newDev[key]
      ) {
        oldDev[key] = newDev[key];
        changed = true
      }
    });
  });
  return {
    changed: changed,
    list_device: config_list_device
  };
}

////////////////////////////////////////////
// Обработка сигналов завершения процесса //
////////////////////////////////////////////

async function shutdown(signal) {
  console.log(`[wb-rosdomofon] Получен ${signal}, завершаем...`);

  // если мы НИКОГДА не подключались — выходим сразу
  if (!isConnected) {
    process.exit(0);
    return;
  }

  // если подключались — аккуратно чистимся
  try {
    await wb.removeDevices();
  } catch (e) {
    console.warn('[wb-rosdomofon] Ошибка при removeDevices:', e.message);
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));