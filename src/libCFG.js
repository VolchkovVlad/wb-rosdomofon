const fs = require('fs');     // Модуль для работы с файловой системой (чтение/запись файлов)
const path = require('path'); // Модуль для безопасной работы с файловыми путями (абсолютные, относительные и т.д.)


class CFG {                                                   // Класс для централизованной работы с конфигурационными файлами
    read_rosdomofon_config(configPath = '../wb-rosdomofon.cfg') { // Метод для чтения конфигурации РосДомофона из файла
        const fullPath = path.resolve(__dirname, configPath); // Преобразуем относительный путь к файлу в абсолютный на основе текущей папки

        if (!fs.existsSync(fullPath)) {                       // Проверяем, существует ли файл
            throw new Error(`[libCFG] ⚠️ Файл не найден: ${fullPath}`);
        }

        try {
            const raw = fs.readFileSync(fullPath, 'utf8');    // Читаем содержимое файла как строку
            const parsed = JSON.parse(raw);                   // Преобразуем строку в JavaScript-объект (JSON → JS object)
            return parsed
        } catch (e) {
            throw new Error(`[libCFG] ❌ Ошибка чтения ${fullPath}: ${e.message}`); // Обрабатываем ошибки чтения или парсинга файла
        }
    }
    write_rosdomofon_config(configPath = '../wb-rosdomofon.cfg', data) { // Метод для записи конфигурации пользователя в файл
        const fullPath = path.resolve(__dirname, configPath); // Преобразуем относительный путь к файлу в абсолютный на основе текущей папки

        try {
            const jsonString = JSON.stringify(data, null, 2); // Преобразуем объект данных в строку JSON с отступами для читаемости
            fs.writeFileSync(fullPath, jsonString, 'utf8');   // Записываем строку JSON в файл
            console.log(`[libCFG] Файл ${fullPath} записан`)
        } catch (e) {
            throw new Error(`[libCFG] ❌ Ошибка записи ${fullPath}: ${e.message}`); // Обрабатываем ошибки записи файла
        }
    }
}

module.exports = CFG;                                         // Экспортируем класс CFG, чтобы его можно было подключать в других модулях

