require('dotenv').config(); // Эта строка загружает ваш токен из файла .env

const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Сервер будет работать на порту 3000

// --- НАСТРОЙКИ TELEGRAM БОТА ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Проверка, что токен бота установлен
if (!TELEGRAM_BOT_TOKEN) {
    console.error("ОШИБКА: Переменная окружения TELEGRAM_BOT_TOKEN не установлена! Проверьте файл .env в папке backend.");
    // Если хотите, чтобы сервер не запускался без токена, раскомментируйте следующую строку:
    // process.exit(1); 
}

// Путь к файлу для хранения данных (сотрудники и архив дежурств)
const DATA_FILE = path.join(__dirname, 'data.json');

// Переменные, которые будут хранить данные в оперативной памяти сервера
let employees = [];
let dutyArchive = [];

// --- Функции для загрузки и сохранения данных в файл ---
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            // Если файл данных существует, читаем его
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            employees = data.employees || [];
            dutyArchive = data.dutyArchive || [];
            console.log('Данные успешно загружены из файла.');
        } else {
            // Если файла нет, инициализируем дефолтных сотрудников
            employees = [
                { name: "JAHONGIRI SH", telegramId: "" }, // ПОЛУЧИТЕ Telegram ID каждого сотрудника и вставьте сюда
                                                                           // Например: { name: "RAHIMOV S", telegramId: "123456789" }
                { name: "ABDURAHMONOV Z", telegramId: "1325889135" },
                 { name: "RAHIMOV S", telegramId: "1160041716" },                                                        // Чтобы получить ID, попросите сотрудника написать что-нибудь вашему боту,
                { name: "RUSLAN K", telegramId: "" },      // а затем откройте в браузере: https://api.telegram.org/botВАШ_ТОКЕН_БОТА/getUpdates
                { name: "DUSTOV M", telegramId: "" },      // Найдите поле "chat":{"id":...}
                { name: "DAVLATOV A", telegramId: "" },
                { name: "ALIMOV Y", telegramId: "" },
            ];
            dutyArchive = [];
            saveData(); // Сохраняем эти дефолтные данные в новый data.json
            console.log('Файл данных не найден, созданы дефолтные сотрудники и сохранены.');
        }
    } catch (error) {
        console.error('Ошибка при загрузке данных:', error);
        // В случае ошибки, инициализируем пустыми списками
        employees = [];
        dutyArchive = [];
    }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ employees, dutyArchive }, null, 2), 'utf8');
    console.log('Данные успешно сохранены в файл.');
}

// --- Настройка Express (API для взаимодействия с фронтендом) ---
app.use(express.json()); // Для парсинга JSON-запросов от фронтенда
app.use(express.static(path.join(__dirname, 'public'))); // Раздача index.html из папки public

// API эндпоинты для получения и сохранения данных
app.get('/api/employees', (req, res) => {
    res.json(employees);
});

app.post('/api/employees', (req, res) => {
    employees = req.body; // Фронтенд отправляет весь массив сотрудников
    saveData();
    res.status(200).send('Employees updated');
});

app.get('/api/archive', (req, res) => {
    res.json(dutyArchive);
});

app.post('/api/archive', (req, res) => {
    dutyArchive = req.body; // Фронтенд отправляет весь массив архива
    saveData();
    res.status(200).send('Archive updated');
});

// --- Логика определения дежурных ---
function getNextSaturday(date = new Date()) {
    const day = date.getDay(); // 0 - воскресенье, 6 - суббота
    const diff = (6 - day + 7) % 7;
    const nextSat = new Date(date);
    nextSat.setDate(date.getDate() + diff);
    nextSat.setHours(0, 0, 0, 0); // Обнуляем время
    return nextSat;
}

function getInitialStartDate() {
    const initialDate = new Date(2025, 0, 4); // Начальная дата графика: 4 января 2025 года
    const dayOfWeek = initialDate.getDay();
    if (dayOfWeek === 6) { // Если это уже суббота
        initialDate.setHours(0, 0, 0, 0);
        return initialDate;
    } else { // Иначе, находим ближайшую субботу после этой даты
        const diff = (6 - dayOfWeek + 7) % 7;
        initialDate.setDate(initialDate.getDate() + diff);
        initialDate.setHours(0, 0, 0, 0);
        return initialDate;
    }
}

function getDutyForDate(date) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    // Сначала ищем в архиве (ручные назначения имеют приоритет)
    const archivedDuty = dutyArchive.find(entry => {
        const archiveDate = new Date(entry.date);
        archiveDate.setHours(0, 0, 0, 0);
        return archiveDate.getTime() === targetDate.getTime();
    });
    if (archivedDuty) {
        return archivedDuty.employee;
    }

    // Если в архиве нет, вычисляем по циклическому графику
    const startDate = getInitialStartDate();
    const weeksPassed = Math.floor((targetDate - startDate) / (7 * 24 * 60 * 60 * 1000));

    if (weeksPassed < 0 || employees.length === 0) {
        return null; // Дата до начала графика или нет сотрудников
    }

    const index = (weeksPassed % employees.length + employees.length) % employees.length;
    return employees[index] ? employees[index].name : null;
}

// --- Функция отправки сообщения в Telegram ---
async function sendTelegramMessage(chatId, message) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.error("Ошибка: Telegram bot token не установлен. Отправка уведомлений невозможна.");
        return;
    }
    try {
        const url = `${TELEGRAM_API}/sendMessage`;
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown' // Для форматирования текста (например, жирный шрифт)
        });
        console.log(`Уведомление успешно отправлено в Telegram для chat ID ${chatId}`);
    } catch (error) {
        console.error(`Ошибка отправки уведомления в Telegram для chat ID ${chatId}:`, error.response ? error.response.data : error.message);
    }
}

// --- Планировщик Cron для Telegram уведомлений ---
// Задача будет выполняться каждую пятницу в 18:00 (6 PM)
// Часовой пояс "Asia/Dushanbe"
cron.schedule('07 12 * * 5', async () => { // 0 минут, 18 часов, любой день месяца, любой месяц, 5 = пятница
    console.log('Запуск задачи Cron: Проверка дежурных на следующую субботу...');

    const today = new Date();
    const nextSaturday = getNextSaturday(today); // Получаем дату следующей субботы
    const nextSaturdayFormatted = nextSaturday.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const dutyEmployeeName = getDutyForDate(nextSaturday); // Определяем, кто дежурит

    if (dutyEmployeeName) {
        // Находим объект сотрудника по имени, чтобы получить его Telegram ID
        const dutyEmployee = employees.find(emp => emp.name === dutyEmployeeName);
        if (dutyEmployee && dutyEmployee.telegramId) {
            const message = `👋 Привет, *${dutyEmployee.name}*! Напоминаем, что *завтра, ${nextSaturdayFormatted}*, вы дежурите.`;
            await sendTelegramMessage(dutyEmployee.telegramId, message);
        } else {
            console.log(`Не удалось найти Telegram ID для сотрудника "${dutyEmployeeName}" или сотрудник не существует/не имеет ID.`);
        }
    } else {
        console.log('Дежурный на следующую субботу не определен (возможно, нет сотрудников).');
    }
}, {
    timezone: "Asia/Dushanbe" // Убедитесь, что эта временная зона верна для ваших сотрудников
});

// --- Запуск сервера ---
loadData(); // Загружаем данные при старте сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Веб-интерфейс доступен по адресу http://localhost:${PORT}/index.html`);
});