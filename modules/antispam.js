const axios = require('axios');

// Key rotation state
let currentKeyIndex = 0;
const getKeys = () => (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(k => k);

/**
 * Analyze content with Gemini AI (Vision + Text) with Automatic Key Rotation
 */
async function analyzeWithGemini(text, imageBase64, imageMime) {
    const keys = getKeys();
    if (keys.length === 0) {
        console.warn('[AI] No GEMINI_API_KEYS set. Skipping AI analysis.');
        return { isSpam: false, reason: '' };
    }

    const parts = [];
    parts.push({
        text: `You are a strict Telegram group moderator AI. Analyze the content below and determine if it is SPAM or PROMOTION.

CRITERIA:
1. PROMOTION: Any image or text promoting a group, channel, product, or service. 
   - Detect subtle tricks like "dm to buy", "check bio", "link in bio", "selling cheap", "available now", "message me for info", "group exchange", or @usernames/links.
   - Look for any attempt to sell products, services, or invite users to other platforms.
2. SPAM: 
   - Long, repetitive, or nonsensical paragraphs (100+ words).
   - Any message that serves no purpose other than solicitation or advertising.
3. LANGUAGE POLICY: 
   - ONLY allow English, Hindi, and Hinglish (Hindi written in English script).
   - Flag any other language (e.g., Arabic, Russian, Urdu, etc.) as a violation.

Respond ONLY with valid JSON in this exact format:
{"isSpam": true/false, "reason": "concise explanation"}

IMPORTANT: 
- Be conservative. If a message is a normal conversation in English, Hindi, or Hinglish, set "isSpam": false. 
- Only flag if it is CLEARLY promotional, blatant spam, or a foreign language (other than English/Hindi). 
- Do NOT flag normal community interaction.
- IMPORTANT: IGNORE adult content or pornographic talk. Do not flag it as spam or promotion. Just allow it through unless it violates the other rules (like promotion).

Content to analyze:
TEXT: "${text || '(no text)'}"
IMAGE: ${imageBase64 ? '(image attached)' : '(no image)'}`
    });

    if (imageBase64 && imageMime) {
        parts.push({
            inlineData: {
                mimeType: imageMime,
                data: imageBase64
            }
        });
    }

    // Try each key until one works or we run out
    for (let i = 0; i < keys.length; i++) {
        const attemptIndex = (currentKeyIndex + i) % keys.length;
        const apiKey = keys[attemptIndex];

        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                { contents: [{ parts }] },
                { timeout: 15000 }
            );

            const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            const cleaned = raw.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            
            // If we successfully used a key that wasn't the first one, stick with it
            currentKeyIndex = attemptIndex;
            
            return { isSpam: !!parsed.isSpam, reason: parsed.reason || '' };
        } catch (e) {
            const status = e.response?.status;
            if (status === 429 || status === 401 || status === 403) {
                console.warn(`[AI] Key ${attemptIndex + 1} failed (${status}). Trying next key...`);
                continue; // Try next key
            }
            console.error(`[AI] Gemini analysis failed with key ${attemptIndex + 1}:`, e.message);
            break; // Stop on other errors
        }
    }

    return { isSpam: false, reason: '' };
}

/**
 * Download Telegram photo as base64
 */
async function getPhotoBase64(ctx) {
    try {
        const photo = ctx.message.photo;
        if (!photo || photo.length === 0) return null;

        const fileId = photo[photo.length - 1].file_id;
        const fileInfo = await ctx.telegram.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;

        const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 10000 });
        const base64 = Buffer.from(response.data).toString('base64');
        const mime = fileInfo.file_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
        return { base64, mime };
    } catch (e) {
        console.error('[AI] Photo download failed:', e.message);
        return null;
    }
}

/**
 * Handle warnings and kicks
 */
async function issueWarning(ctx, reason) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const userName = ctx.from.first_name;

    const row = await ctx.dbAsync.get(
        'SELECT count FROM warnings WHERE user_id = ? AND chat_id = ?',
        [userId, chatId]
    );
    
    const newCount = (row ? row.count : 0) + 1;

    if (row) {
        await ctx.dbAsync.run(
            'UPDATE warnings SET count = ? WHERE user_id = ? AND chat_id = ?',
            [newCount, userId, chatId]
        );
    } else {
        await ctx.dbAsync.run(
            'INSERT INTO warnings (user_id, chat_id, count) VALUES (?, ?, ?)',
            [userId, chatId, newCount]
        );
    }

    if (newCount >= 3) {
        try {
            await ctx.banChatMember(userId);
            await ctx.unbanChatMember(userId);
            await ctx.dbAsync.run('DELETE FROM warnings WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
            ctx.reply(`🚫 *User Kicked*\n\n${userName} has been removed after 3 violations.\nReason: ${reason}`, { parse_mode: 'Markdown' });
        } catch (e) {
            console.error('[MOD] Kick failed:', e.message);
        }
    } else {
        ctx.reply(`⚠️ *Warning ${newCount}/3* — ${userName}\n\n*Reason:* ${reason}\n\nOne more violation and you will be kicked.`, { parse_mode: 'Markdown' });
    }
}

function setupAntiSpam(bot) {
    bot.on(['message', 'edited_message'], async (ctx, next) => {
        if (!ctx.chat || ctx.chat.type === 'private') return next();

        // Skip admins
        try {
            const member = await ctx.getChatMember(ctx.from.id);
            if (['creator', 'administrator'].includes(member.status)) return next();
        } catch (e) {}

        const text = (ctx.message?.text || ctx.message?.caption || '').trim();
        const wordCount = text.split(/\s+/).length;
        const hasPhoto = !!(ctx.message?.photo && ctx.message.photo.length > 0);

        let shouldCheckAI = false;
        let spamReason = '';

        // 1. Basic length check (100+ words)
        if (wordCount >= 100) {
            shouldCheckAI = true;
            spamReason = 'Exceptionally long message (potential spam)';
        }

        // 2. Promotion keywords check (fast) - triggers AI analysis
        const promoPattern = /\b(link in bio|check bio|join my channel|t\.me\/|https?:\/\/|dm to buy|selling|cheap|available|order now|msg me|price|discount|exchange|dm me)\b/gi;
        if (promoPattern.test(text)) {
            shouldCheckAI = true;
            spamReason = 'Potential promotion detected';
        }

        // 3. Language/Script check (fast)
        const foreignScriptPattern = /[^\u0000-\u007F\u0900-\u097F\s\.,!?]/;
        if (text && foreignScriptPattern.test(text)) {
            shouldCheckAI = true;
            spamReason = 'Non-allowed language script detected';
        }

        // 4. Always check AI if there is a photo (to find text in image)
        if (hasPhoto) {
            shouldCheckAI = true;
        }

        if (shouldCheckAI) {
            let photoData = null;
            if (hasPhoto) photoData = await getPhotoBase64(ctx);

            const aiResult = await analyzeWithGemini(
                text,
                photoData?.base64 || null,
                photoData?.mime || null
            );

            if (aiResult.isSpam) {
                console.log(`[AntiSpam] 🛡️ AI Flagged content from ${ctx.from.first_name}: ${aiResult.reason}`);
                await ctx.deleteMessage().catch(() => {});
                await issueWarning(ctx, aiResult.reason || spamReason);
                return;
            } else {
                console.log(`[AntiSpam] ✅ AI cleared content from ${ctx.from.first_name}`);
            }
        }

        return next();
    });
}

module.exports = { setupAntiSpam };
