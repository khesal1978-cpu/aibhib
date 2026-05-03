require('dotenv').config();
const { Telegraf } = require('telegraf');
const { db, dbAsync } = require('./database');
const { setupAntiSpam } = require('./modules/antispam');

const token = process.env.BOT_TOKEN;
if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.error('ERROR: Please set your BOT_TOKEN in the .env file!');
    process.exit(1);
}

const bot = new Telegraf(token);

bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

// Middleware to inject database into context
bot.use((ctx, next) => {
    ctx.db = db;
    ctx.dbAsync = dbAsync;
    return next();
});

// Setup Anti-Spam module
setupAntiSpam(bot);

bot.start((ctx) => {
    ctx.reply('🛡️ *AI Group Manager Active*\n\nI am monitoring this group for:\n- Promotional images ("link in bio")\n- Long spam paragraphs\n- 3-warning kick system', { parse_mode: 'Markdown' });
});

// Function to start the bot
async function startBot() {
    console.log('Waiting for database connection...');
    // We'll just wait a second since the sqlite3 connection doesn't provide a promise-based 'ready' event easily in this setup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Attempting to launch bot...');
    try {
        await bot.launch({ polling: { dropPendingUpdates: true } });
        console.log('🚀 Bot is running and protecting your groups!');
    } catch (err) {
        console.error('Failed to launch bot:', err);
    }
}

startBot();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
