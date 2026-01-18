# WB-ROSDOMOFON

Драйвер для интеграции сервиса **РосДомофон** с контроллерами **Wiren Board**.

---

## Описание

**WB-ROSDOMOFON** — проект для интеграции сервиса РосДомофон с контроллерами Wiren Board.

Сервис позволяет:

- открывать двери, ворота, калитки, шлагбаумы;
- получать RTSP-ссылки для просмотра камер;
- управлять настройками пользователя:
  - заглушать звонки;
  - заглушать уведомления от чатов.

**Планируется к добавлению:**

- определение входящего вызова;
- режим авто-вахтёра / курьера  
  (автоматическое открытие двери при звонке).

---

## Используемые интерфейсы

### РосДомофон
- API:  
  https://rdba.rosdomofon.com/swagger-ui.html?urls.primaryName=abonents

### Wiren Board
- Протокол: **MQTT**
- Топики формируются согласно:
  https://github.com/wirenboard/conventions/tree/main

---

## Установка

1. Подключитесь к контроллеру Wiren Board по SSH  
   *(по умолчанию: `root / wirenboard`)*

2. Выполните команду:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/VolchkovVlad/wb-rosdomofon/main/install.sh | sh
