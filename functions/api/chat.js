
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message, sessionId } = await request.json();

    if (!message || !sessionId) {
      return new Response(JSON.stringify({ reply: 'طلب غير صالح.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1. حفظ رسالة المستخدم
    await env.DB.prepare(
      "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"
    ).bind(sessionId, 'user', message).run();

    // 2. جلب كل المعرفة عن خالد
    const knowledgeResult = await env.DB.prepare(
      "SELECT category, fact FROM knowledge ORDER BY category"
    ).all();
    
    const knowledgeText = knowledgeResult.results
      .map(k => `- ${k.fact}`)
      .join('\n');

    // 3. جلب آخر 6 رسائل من المحادثة (سياق)
    const historyResult = await env.DB.prepare(
      "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 6"
    ).bind(sessionId).all();

    const conversationHistory = historyResult.results.reverse();

    // 4. بناء التعليمات (System Prompt)
    const systemPrompt = `أنت مساعد ذكي يمثل خالد وليد المقرمي، لاعب فري فاير.

📋 معرفة عن خالد (أولوية أولى - استخدمها عند السؤال عنه):
${knowledgeText || '(لا توجد معلومات شخصية)'}

🎯 قواعد الإجابة:
1. إذا كان السؤال عن خالد شخصياً → أجِب حصراً من "معرفة خالد" أعلاه.
2. إذا كان السؤال عن فري فاير بشكل عام (نصائح، طرق لعب، أسلحة، خرائط) → أجِب من معرفتك العامة كخبير في اللعبة.
3. إذا سأل الزائر سؤالاً عاماً (غير فري فاير وغير خالد) → أجِب بذكاء من معرفتك.
4. إذا لم تكن متأكداً → قل "لا أعرف" بدل اختراع إجابة.
5. تحدث بالعربية بطبيعية وودّية، وباختصار (2-4 جمل).
6. لا تكشف أنك Gemini أو أي نموذج ذكاء اصطناعي.

سؤال الزائر: ${message}`;

    // 5. استدعاء Gemini
    const apiKey = env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: systemPrompt }]
          }
        ]
      })
    });

    const geminiData = await geminiRes.json();
    const botReply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text 
      || 'عذراً، لم أستطع توليد رد. حاول مرة أخرى.';

    // 6. حفظ رد البوت
    await env.DB.prepare(
      "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"
    ).bind(sessionId, 'bot', botReply).run();

    // 7. إرجاع الرد
    return new Response(JSON.stringify({ reply: botReply }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      reply: 'حدث خطأ: ' + error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
