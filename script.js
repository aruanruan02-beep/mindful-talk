const DB_NAME = 'MindfulTalk_V33_8'; // 升级数据库版本
const SHOW_TEST_BUTTON = true;       // 🔴 测试开关：上线前改为 false

let db;
let currentCalYear = new Date().getFullYear();
let currentCalMonth = new Date().getMonth() + 1; 
let filterDate = null; 
let isCalendarExpanded = true; 
let currentRecordId = null; 
let savedSessionId = null; 

// === 核心锁 ===
let isProcessingEnd = false; 
let isBatchStarted = false;  

const getTodayStr = () => { const d=new Date(); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; };
const VALID_CODES = ["EARLY100", "LOVE2024", "VIP888", "OPEN001"]; 

function initDB() {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => { db = e.target.result; if(!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', {keyPath: 'id'}); };
    r.onsuccess = e => { 
        db = e.target.result; 
        const tx = db.transaction(['sessions'], 'readonly');
        if(tx.objectStore('sessions').count().result === 0) seedMockData();
        loadHistoryList();
    };
}
function seedMockData() {
    const mockBlob = new Blob([""], { type: 'audio/webm' });
    const mocks = [{ 
        id: 1001, date: getTodayStr(), timestamp: Date.now(), status: 'completed',
        title: "示例：关于周末安排的沟通", 
        insight: "<h4>💡 关系共鸣</h4><p>尽管话题从周末安排开始...</p>",
        segments: [
            {speaker:"Alex", role:"讲述", text:"我觉得这周很累。", blob:mockBlob}, 
            {speaker:"Jamie", role:"复述", text:"你觉得累？", blob:mockBlob}
        ],
        displayTranscript: [] 
    }];
    const tx = db.transaction(['sessions'], 'readwrite');
    mocks.forEach(m => tx.objectStore('sessions').add(m));
    tx.oncomplete = () => loadHistoryList();
}
window.onload = initDB;

let names = { A: "A", B: "B" };
let phases = [], phaseIdx = 0, timerInterval;
let mediaRecorder, audioChunks = [], sessionSegments = [];
let supportedMime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';

// === UI 辅助 ===
function showNiceAlert(title, msg, icon='✨', callback=null) {
    document.getElementById('alert-title').innerText = title;
    document.getElementById('alert-msg').innerHTML = msg.replace(/\n/g, '<br>');
    document.getElementById('alert-icon').innerText = icon;
    document.getElementById('modal-loading').style.display = 'none';
    
    const btn = document.querySelector('#modal-alert button');
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    newBtn.onclick = () => {
        document.getElementById('modal-alert').style.display = 'none';
        if (callback) callback();
    };
    
    document.getElementById('modal-alert').style.display = 'flex';
}
function closeAlert() { document.getElementById('modal-alert').style.display = 'none'; }

function updateLoadingStatus(text, subText = "") {
    document.getElementById('loading-step').innerText = text;
    if(subText) document.getElementById('loading-sub').innerText = subText;
}

// === 辅助：重置跳过按钮 (修复 BUG 的关键) ===
function resetSkipButton() {
    const btn = document.querySelector('.float-skip');
    if (btn) {
        // 只有测试模式才显示
        btn.style.display = SHOW_TEST_BUTTON ? 'block' : 'none';
        btn.innerText = "跳过当前阶段 (测试)";
        btn.style.pointerEvents = "auto"; // 👈 恢复可点击
        btn.style.opacity = "1";          // 👈 恢复不透明度
    }
}

// 录音与流程
function checkPermissionAndStart() {
    names.A = document.getElementById('nameA').value.trim() || "A";
    names.B = document.getElementById('nameB').value.trim() || "B";
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        mediaRecorder = new MediaRecorder(stream, { mimeType: supportedMime });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: supportedMime });
            const p = phases[phaseIdx];
            if (!isProcessingEnd && phaseIdx < phases.length - 1) {
                sessionSegments.push({ blob: blob, speaker: p.act==='BOTH'?'Both':p.act, role: p.role, text: "" });
                proceedNext();
            } else {
                if(!isBatchStarted) sessionSegments.push({ blob: blob, speaker: p.act==='BOTH'?'Both':p.act, role: p.role, text: "" });
            }
        };
        startSession();
    }).catch(e => showNiceAlert("无法录音", "请允许麦克风权限", "🎤"));
}

function startSession() {
    sessionSegments = [];
    savedSessionId = null;
    isProcessingEnd = false; 
    isBatchStarted = false;
    
    resetSkipButton(); // 初始重置

    phases = [
        { act: names.A, role: '讲述', t: 180, s: "专注表达感受 (我感到...)", l: "全神贯注倾听，不打断" },
        { act: names.B, role: '复述', t: 120, s: "复述听到的话，不评判", l: "确认对方是否理解准确" },
        { act: 'BOTH', role: '交流', t: 60, s: "<span style='font-size:18px; color:#444; font-weight:500;'>自由交流</span><br><span style='font-size:13px; opacity:0.7; display:block; margin-top:6px;'>核对刚才的理解 · 分享此刻的感受</span>", l: "" },
        { swap: true },
        { act: names.B, role: '讲述', t: 180, s: "专注表达感受 (我感到...)", l: "全然同在，体会对方情绪" },
        { act: names.A, role: '复述', t: 120, s: "复述听到的话，不评判", l: "让对方感受到被听见" },
        { act: 'BOTH', role: '交流', t: 60, s: "<span style='font-size:18px; color:#444; font-weight:500;'>自由交流</span><br><span style='font-size:13px; opacity:0.7; display:block; margin-top:6px;'>总结各自的感受 · 感谢彼此的专注</span>", l: "" }
    ];
    phaseIdx = 0; showScreen('screen-interim'); setupInterim();
}

function setupInterim() {
    const p = phases[phaseIdx];
    if(phaseIdx===0) {
        document.getElementById('interim-title').innerText = "准备开始";
        document.getElementById('interim-desc').innerHTML = `由 <b>${names.A}</b> 先讲述`;
    } else if(p.swap) {
        document.getElementById('interim-title').innerText = "交换角色";
        document.getElementById('interim-desc').innerHTML = `轮到 <b>${names.B}</b> 讲述`;
    }
}

function resumeFlow() {
    if(phases[phaseIdx].swap) { phaseIdx++; resumeFlow(); return; }
    showScreen('screen-timer'); audioChunks = [];
    if(mediaRecorder.state==='inactive') mediaRecorder.start();
    runTimer();
}

function runTimer() {
    // 🔴 关键修复：每次进入计时页面，都把按钮状态复原！
    resetSkipButton();

    const p = phases[phaseIdx];
    const top = document.getElementById('pane-top');
    const bot = document.getElementById('pane-bottom');
    const full = document.getElementById('pane-full');
    document.getElementById('name-top').innerText = names.A;
    document.getElementById('name-bottom').innerText = names.B;

    if (p.act === 'BOTH') {
        full.style.display = 'flex';
        document.getElementById('timer-full').innerText = formatTime(p.t);
        document.getElementById('instr-full').innerHTML = p.s;
    } else {
        full.style.display = 'none';
        document.getElementById('timer-top').innerText = formatTime(p.t);
        document.getElementById('timer-bottom').innerText = formatTime(p.t);
        
        if (p.act === names.A) {
            top.classList.add('active'); top.classList.remove('inactive');
            bot.classList.add('inactive'); bot.classList.remove('active');
            document.getElementById('instr-top').innerText = p.s;
            document.getElementById('instr-bottom').innerText = p.l;
        } else {
            bot.classList.add('active'); bot.classList.remove('inactive');
            top.classList.add('inactive'); top.classList.remove('active');
            document.getElementById('instr-bottom').innerText = p.s;
            document.getElementById('instr-top').innerText = p.l;
        }
    }

    let t = p.t;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        t--; 
        if(p.act === 'BOTH') document.getElementById('timer-full').innerText = formatTime(t);
        else {
            document.getElementById('timer-top').innerText = formatTime(t);
            document.getElementById('timer-bottom').innerText = formatTime(t);
        }
        if(t<=0) finishPhase();
    }, 1000);
}

function formatTime(s) {
    const m = Math.floor(s/60).toString().padStart(2,'0');
    const sec = (s%60).toString().padStart(2,'0');
    return `${m}:${sec}`;
}

// 手动跳过
function skipPhase() {
    if (isProcessingEnd) return; 
    
    // 点击后变灰，防止连点
    const btn = document.querySelector('.float-skip');
    if(btn) {
        btn.innerText = "处理中...";
        btn.style.pointerEvents = "none";
        btn.style.opacity = "0.7";
    }
    finishPhase();
}

function finishPhase() {
    clearInterval(timerInterval);
    if (isProcessingEnd) return;

    if (mediaRecorder.state === 'recording') mediaRecorder.stop();

    if (phaseIdx >= phases.length - 1) {
        handleFinalStep();
    }
}

function handleFinalStep() {
    if (isProcessingEnd) return;
    isProcessingEnd = true; 

    document.getElementById('modal-loading').style.display = 'flex';
    updateLoadingStatus("正在保存对话...", "整理数据中");

    setTimeout(() => {
        if (sessionSegments.length < phases.length) {
             const blob = new Blob(audioChunks, { type: supportedMime });
             sessionSegments.push({ blob: blob, speaker: 'Both', role: '交流', text: "" });
        }

        if (localStorage.getItem('is_vip_user') === 'true') { 
            startBatchProcessing(); 
        } else { 
            document.getElementById('modal-loading').style.display = 'none';
            showScreen('screen-paywall'); 
        }
    }, 500);
}

function proceedNext() { 
    if (isProcessingEnd) return; 
    phaseIdx++; 
    if (phases[phaseIdx].swap) { showScreen('screen-interim'); setupInterim(); } 
    else { audioChunks=[]; mediaRecorder.start(); runTimer(); } 
}

// 激活与数据
// === 替换原有的 verifyAndUnlock 函数 ===

function verifyAndUnlock() {
    const input = document.getElementById('activationCode').value.trim().toUpperCase();
    
    // 1. 如果已经是 VIP，直接重置状态并开始
    if (localStorage.getItem('is_vip_user') === 'true') { 
        savedSessionId = null;   // <--- 强制重置 ID
        isBatchStarted = false;  // <--- 强制重置锁
        startBatchProcessing(); 
        return; 
    }

    // 2. 校验激活码
    if (VALID_CODES.includes(input)) {
        localStorage.setItem('is_vip_user', 'true');
        
        showNiceAlert("激活成功", "即将开始分析...", "🎉", () => {
            // 在点击“知道了”之后执行：
            savedSessionId = null;   // <--- 强制重置 ID
            isBatchStarted = false;  // <--- 强制重置锁
            
            // 再次检查有没有音频数据
            if (!sessionSegments || sessionSegments.length === 0) {
                alert("未找到录音数据，请重新上传或录音");
                return;
            }
            startBatchProcessing();
        });
    } else { 
        showNiceAlert("无效", "请检查激活码", "🥺"); 
    }
}
function copyWeChat() { navigator.clipboard.writeText("Mindful_Dev").then(()=>showNiceAlert("微信号已复制","Mindful_Dev","📋")); }
function clearData() { if(confirm("清除所有数据?")) { localStorage.clear(); indexedDB.deleteDatabase(DB_NAME); location.reload(); } }

// === AI 核心逻辑 ===
async function performAIAnalysis(segments, apiKey) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); 

    try {
        const processedSegments = await Promise.all(segments.map(async s => {
            if(s.blob.size < 200) return {...s, text:"(无声音)"};
            const formData = new FormData();
            formData.append('file', s.blob, 'audio.webm');
            formData.append('model', 'FunAudioLLM/SenseVoiceSmall');
            
            const res = await fetch("https://api.siliconflow.cn/v1/audio/transcriptions", { 
                method:"POST", 
                headers:{"Authorization":`Bearer ${apiKey}`}, 
                body:formData,
                signal: controller.signal 
            });
            const d = await res.json();
            return {...s, text: d.text || "(静默)"};
        }));

        const rawText = processedSegments.map(s => `[阶段:${s.role}, 说话人:${s.speaker}] ${s.text}`).join('\n');
        const prompt = `
# Role (角色设定)
你是一款名为“正念伴侣”的 AI 情感支持系统。你的理念源自“非暴力沟通 (NVC)”与“人本主义心理学”。
你面对的是一对通过“3-2-1”机制进行对话的伴侣（A和B，名字分别是 ${names.A} 和 ${names.B}）。
你的核心价值观是：**不评判、不比较、不打分。** 你相信每一次尝试沟通都是爱的表现。

# Context (背景)
用户进行了两轮完整的互动：
1. [Round 1] ${names.A}讲述 -> ${names.B}复述 -> 自由交流
2. [Round 2] ${names.B}讲述 -> ${names.A}复述 -> 自由交流

# Task (任务目标)
请生成一份【关系深度共鸣报告】。
1. **去评判化**：严禁使用“A 比 B 做得好”、“B 的表现很差”等比较或打分性语言。
2. **深度翻译**：帮助“讲述者”理清表面抱怨背后的深层愿望（渴望被爱、安全感、价值感等）。
3. **看见努力**：肯定“倾听者”的努力，即使复述不完美，也要先肯定意愿，再温柔地给出“如何听得更深”的建议。

# Output Format (JSON Only)
⚠️ 请严格返回纯 JSON 格式 (不要包含 Markdown 代码块标记)。
请将报告内容转换为 HTML 标签 (使用 h4, p, ul, li) 并放入 "insight" 字段。

JSON 结构示例：
{
  "title": "简短温暖的标题",
  "insight": "这里放入转换后的 HTML 内容",
  "reorganized_transcript": [ {"speaker": "Name", "text": "Content"} ]
}

HTML 内容结构：
<h4>💡 关系共鸣 (Relationship Resonance)</h4>
<p>用温暖的语言，概括这两轮对话中双方共同呈现出的意愿...</p>

<h4>🟣 第一轮：${names.A} 的内心世界</h4>
<ul>
  <li><strong>表象与冰山</strong>：你谈到了 [事件]... 真正想表达的或许是...</li>
  <li><strong>给倾听者 (${names.B}) 的反馈</strong>：...</li>
</ul>

<h4>🔵 第二轮：${names.B} 的内心世界</h4>
<ul>
  <li><strong>表象与冰山</strong>：你谈到了 [事件]... 真正想表达的或许是...</li>
  <li><strong>给倾听者 (${names.A}) 的反馈</strong>：...</li>
</ul>

<h4>🧩 拼图时刻 (The Connection)</h4>
<p>...</p>

<h4>🌱 共同的一小步</h4>
<p>...</p>

# Input Dialogue
${rawText}`;

        const res2 = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
            method:"POST", headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},
            body:JSON.stringify({model:"deepseek-ai/DeepSeek-V3", messages:[{role:"user",content:prompt}]}),
            signal: controller.signal 
        });
        
        clearTimeout(timeoutId);

        const d2 = await res2.json();
        let content = d2.choices[0].message.content.trim();
        content = content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
        const aiData = JSON.parse(content);

        return {
            processedSegments,
            title: aiData.title,
            insight: aiData.insight,
            transcript: aiData.reorganized_transcript
        };
    } catch(err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// === 5. 智能竞速处理流程 ===
async function startBatchProcessing() {
    if (isBatchStarted || savedSessionId) return;
    isBatchStarted = true;

    const apiKey = localStorage.getItem('sf_api_key');
    if(!apiKey) { 
        document.getElementById('modal-loading').style.display='none';
        document.getElementById('modal-settings').style.display='flex';
        document.querySelector('#modal-settings h3').innerText = "请先配置 API Key";
        document.getElementById('settings-hint').innerText = "配置后点击保存即可开始分析";
        const originalSave = window.saveSettings;
        window.saveSettings = function() {
            localStorage.setItem('sf_api_key', document.getElementById('apiKeyInput').value.trim());
            document.getElementById('modal-settings').style.display='none';
            isBatchStarted = false; 
            startBatchProcessing(); 
            window.saveSettings = originalSave; 
        };
        return; 
    }

    const newId = Date.now();
    
    const placeholderRecord = { 
        id: newId, 
        date: getTodayStr(), 
        timestamp: Date.now(),
        status: 'processing', 
        title: "AI 正在分析中...", 
        insight: "",
        rawSegments: sessionSegments, 
        displayTranscript: [] 
    };

    const tx = db.transaction(['sessions'], 'readwrite');
    tx.objectStore('sessions').add(placeholderRecord);
    
    tx.onerror = () => {
        document.getElementById('modal-loading').style.display = 'none';
        showNiceAlert("错误", "存储空间不足", "❌");
    };

    tx.oncomplete = () => {
        savedSessionId = newId; 

        // 🔴 文案已更新
        document.getElementById('modal-loading').style.display = 'flex';
        updateLoadingStatus("AI 正在用心感知...", "分析需要一点时间，请耐心等待...");

        const aiTask = performAIAnalysis(sessionSegments, apiKey);
        // 🔴 60秒倒计时
        const timeoutTask = new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 60000));

        Promise.race([aiTask, timeoutTask]).then(winner => {
            if (winner === 'TIMEOUT') {
                document.getElementById('modal-loading').style.display = 'none';
                showNiceAlert(
                    "思考比较深入", 
                    "AI 还在努力分析中... \n为节省您的时间，已转入后台处理。\n您可以稍后去【历史记录】查看结果。", 
                    "☕️", 
                    () => { switchTab('history'); } 
                );
                aiTask.then(result => updateDBWithResult(newId, result))
                      .catch(err => markDBAsFailed(newId));
            } else {
                updateDBWithResult(newId, winner).then(() => {
                    document.getElementById('modal-loading').style.display = 'none';
                    const tx2 = db.transaction(['sessions'], 'readonly');
                    tx2.objectStore('sessions').get(newId).onsuccess = (e) => loadDetail(e.target.result);
                });
            }
        }).catch(err => {
            document.getElementById('modal-loading').style.display = 'none';
            console.error(err);
            markDBAsFailed(newId);
            showNiceAlert("分析中断", "请在历史记录中点击重试。", "⚠️", () => switchTab('history'));
        });
    };
}

function updateDBWithResult(id, result) {
    return new Promise((resolve) => {
        const tx = db.transaction(['sessions'], 'readwrite');
        const store = tx.objectStore('sessions');
        store.get(id).onsuccess = (e) => {
            const record = e.target.result;
            if (record) {
                record.status = 'completed';
                record.title = result.title;
                record.insight = result.insight;
                record.rawSegments = result.processedSegments; 
                record.displayTranscript = result.transcript;
                store.put(record);
                if(document.getElementById('tab-history').classList.contains('active')) loadHistoryList();
            }
        };
        tx.oncomplete = () => resolve();
    });
}

function markDBAsFailed(id) {
    const tx = db.transaction(['sessions'], 'readwrite');
    const store = tx.objectStore('sessions');
    store.get(id).onsuccess = (e) => {
        const record = e.target.result;
        if (record) {
            record.status = 'failed';
            record.title = "分析超时 (点击重试)";
            store.put(record);
            if(document.getElementById('tab-history').classList.contains('active')) loadHistoryList();
        }
    };
}

function saveOnly() { 
    if (isBatchStarted || savedSessionId) {
        if(savedSessionId) window.fetchAndShow(savedSessionId);
        return;
    }
    isBatchStarted = true;

    const newId = Date.now();
    savedSessionId = newId;
    
    const rec = { 
        id: newId, 
        date: getTodayStr(), timestamp: Date.now(), 
        status: 'failed', 
        title: "未分析对话", 
        insight: "", 
        rawSegments: sessionSegments, 
        displayTranscript: [] 
    };
    const tx = db.transaction(['sessions'], 'readwrite');
    tx.objectStore('sessions').add(rec);
    tx.oncomplete = () => { 
        loadDetail(rec);
    };
}

// === 详情页渲染 ===
function loadDetail(r) {
    currentRecordId = r.id; 
    document.getElementById('d-title').innerText = r.title;
    document.getElementById('d-date').innerText = r.date;
    
    if (r.status === 'processing') {
        document.getElementById('insight-container').style.display = 'none';
        document.getElementById('transcript-container').style.display = 'none';
        
        const emptyBox = document.getElementById('empty-analysis-box');
        emptyBox.style.display = 'flex';
        emptyBox.innerHTML = `
            <div class="loading-spinner" style="width:40px;height:40px;border-width:3px;"></div>
            <p class="empty-text">AI 正在后台努力分析中...<br>您可以稍后回来刷新查看</p>
            <button class="btn-retry" onclick="loadHistoryList(); switchTab('history')">返回列表</button>
        `;
        showScreen('screen-detail');
        return;
    }

    document.getElementById('empty-analysis-box').innerHTML = `
        <div class="empty-icon">✨</div>
        <p class="empty-text">该对话暂无 AI 分析报告<br>点击下方按钮生成深度洞察</p>
        <button class="btn-retry" onclick="retryAnalysis(currentRecordId)">
            <span>⚡</span> 立即生成报告
        </button>
    `;

    const hasAnalysis = r.insight && r.displayTranscript && r.displayTranscript.length > 0;
    
    if (hasAnalysis) {
        document.getElementById('insight-container').style.display = 'block';
        document.getElementById('transcript-container').style.display = 'block';
        document.getElementById('empty-analysis-box').style.display = 'none';
        document.getElementById('d-insight').innerHTML = r.insight;
    } else {
        document.getElementById('insight-container').style.display = 'none';
        document.getElementById('transcript-container').style.display = 'none';
        document.getElementById('empty-analysis-box').style.display = 'flex';
    }

    let speakerA = names.A;
    if (r.rawSegments && r.rawSegments.length > 0) {
        const first = r.rawSegments.find(s => s.role === '讲述') || r.rawSegments[0];
        if (first) speakerA = first.speaker;
    }
    try {
        const fullBlob = new Blob(r.rawSegments.map(s=>s.blob), {type:supportedMime});
        if(fullBlob.size>100) document.getElementById('d-full-audio').src = URL.createObjectURL(fullBlob);
    } catch(e) {}

    if (hasAnalysis) {
        const list = r.displayTranscript;
        document.getElementById('d-transcript-box').innerHTML = list.map(item => {
            const isA = item.speaker === speakerA || item.speaker.includes(speakerA);
            const isBoth = item.speaker === 'Both' || item.speaker === '交流' || item.speaker.includes('&');
            let align = 'right'; 
            if (isA) align = 'left'; 
            if (isBoth) align = 'center';
            return `<div class="chat-row ${align}"><div class="chat-name">${item.speaker}</div><div class="chat-bubble">${item.text}</div></div>`;
        }).join('');
    }
    
    showScreen('screen-detail');
}

async function retryAnalysis(id) {
    if (localStorage.getItem('is_vip_user') !== 'true') {
        showScreen('screen-paywall');
        return;
    }
    const apiKey = localStorage.getItem('sf_api_key');
    if(!apiKey) { showNiceAlert("请先配置 API Key", "点击首页右上角设置", "🔑"); return; }

    const tx = db.transaction(['sessions'], 'readwrite');
    const store = tx.objectStore('sessions');
    
    store.get(id).onsuccess = (e) => {
        const record = e.target.result;
        if (!record) return;

        record.status = 'processing';
        record.title = "正在重新分析...";
        store.put(record);
        
        document.getElementById('modal-loading').style.display = 'flex';
        updateLoadingStatus("正在重新分析...", "60秒内出结果，请稍候...");

        const aiTask = performAIAnalysis(record.rawSegments, apiKey);
        const timeoutTask = new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 60000));

        Promise.race([aiTask, timeoutTask]).then(winner => {
            if (winner === 'TIMEOUT') {
                document.getElementById('modal-loading').style.display = 'none';
                showNiceAlert("分析进行中", "已转入后台处理，请稍后查看。", "⏳", () => switchTab('history'));
                aiTask.then(res => updateDBWithResult(id, res)).catch(() => markDBAsFailed(id));
            } else {
                updateDBWithResult(id, winner).then(() => {
                    document.getElementById('modal-loading').style.display = 'none';
                    const tx2 = db.transaction(['sessions'], 'readonly');
                    tx2.objectStore('sessions').get(id).onsuccess = (ev) => loadDetail(ev.target.result);
                });
            }
        }).catch(() => {
            document.getElementById('modal-loading').style.display = 'none';
            markDBAsFailed(id);
            showNiceAlert("失败", "请检查网络", "⚠️");
        });
    };
}

window.fetchAndShow = function(id) { 
    const numericId = Number(id);
    const tx = db.transaction(['sessions'], 'readonly'); 
    tx.objectStore('sessions').get(numericId).onsuccess = e => {
        if(e.target.result) loadDetail(e.target.result);
    }; 
};

// === 历史列表 ===
function loadHistoryList() {
    const tx = db.transaction(['sessions'], 'readwrite');
    const store = tx.objectStore('sessions');
    store.getAll().onsuccess = e => {
        let list = e.target.result.sort((a,b)=>b.timestamp-a.timestamp);
        
        const now = Date.now();
        list.forEach(item => {
            if (item.status === 'processing' && (now - item.timestamp > 300000)) { 
                item.status = 'failed';
                item.title = "分析超时 (点击重试)";
                store.put(item);
            }
        });

        renderCalendar(list);
        let showList = list;
        if(filterDate) showList = list.filter(i => i.date === filterDate);
        
        const container = document.getElementById('history-list-container');
        if (showList.length === 0) {
            container.innerHTML = `<div style="text-align:center;color:#ccc;margin-top:40px;font-weight:300;">暂无记录</div>`;
        } else {
            let html = `<div style="text-align:right; margin-bottom:10px;"><button onclick="loadHistoryList()" style="border:none;background:none;color:var(--primary);font-size:13px;cursor:pointer;">↻ 刷新状态</button></div>`;
            html += showList.map(i => {
                let icon = '✨';
                let statusClass = '';
                let subText = i.date;
                if (i.status === 'processing') {
                    icon = '<div class="spinner-mini"></div>';
                    subText = '<span style="color:var(--primary);">AI 正在思考中...</span>';
                    statusClass = 'processing-card';
                } else if (i.status === 'failed') {
                    icon = '⚠️';
                    subText = '<span style="color:#FF6B6B;">分析失败</span>';
                } else if (!i.insight) {
                    icon = '🎙';
                    subText += ' (未分析)';
                }
                return `
                <div class="history-card ${statusClass}" onclick="fetchAndShow(${i.id})">
                    <div class="h-icon">${icon}</div>
                    <div style="flex:1;">
                        <div class="h-title">${i.title}</div>
                        <div class="h-date">${subText}</div>
                    </div>
                </div>
            `}).join('');
            container.innerHTML = html;
        }
        document.getElementById('reset-filter').style.display = filterDate ? 'block' : 'none';
    };
}

function toggleCalendar() {
    isCalendarExpanded = !isCalendarExpanded;
    const grid = document.getElementById('cal-grid');
    const icon = document.getElementById('cal-toggle-icon');
    if (isCalendarExpanded) {
        grid.classList.remove('collapsed');
        icon.style.transform = 'rotate(0deg)';
    } else {
        grid.classList.add('collapsed');
        icon.style.transform = 'rotate(-90deg)';
    }
}
function changeMonth(delta) {
    currentCalMonth += delta;
    if (currentCalMonth > 12) { currentCalMonth = 1; currentCalYear++; }
    else if (currentCalMonth < 1) { currentCalMonth = 12; currentCalYear--; }
    loadHistoryList();
}
function renderCalendar(fullList) {
    document.getElementById('cal-current-month').innerText = `${currentCalYear}/${String(currentCalMonth).padStart(2,'0')}`;
    const dataSet = new Set();
    fullList.forEach(item => {
        const [y, m, d] = item.date.split('/');
        if (parseInt(y) === currentCalYear && parseInt(m) === currentCalMonth) dataSet.add(parseInt(d));
    });
    const grid = document.getElementById('cal-grid'); 
    grid.innerHTML = '';
    const daysInMonth = new Date(currentCalYear, currentCalMonth, 0).getDate();
    for(let d=1; d<=daysInMonth; d++) {
        const el = document.createElement('div');
        const hasData = dataSet.has(d);
        el.className = 'cal-day ' + (hasData ? 'has-data' : '');
        el.innerText = d;
        const thisDateStr = `${currentCalYear}/${String(currentCalMonth).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
        if(filterDate === thisDateStr) el.classList.add('active');
        if(hasData || filterDate === thisDateStr) {
            el.onclick = () => { filterDate = thisDateStr; loadHistoryList(); };
            el.style.cursor = 'pointer';
        } else {
            el.style.cursor = 'default'; el.style.opacity = '0.3';
        }
        grid.appendChild(el);
    }
}
function resetFilter() { filterDate = null; loadHistoryList(); }
function switchTab(t) {
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.querySelectorAll('.tab-item').forEach(i=>i.classList.remove('active'));
    document.getElementById('btn-'+t).classList.add('active');
    const hideTabs = ['screen-timer','screen-interim','screen-paywall'];
    document.getElementById('tab-bar').style.display = hideTabs.includes('tab-'+t) ? 'none' : 'flex';
    if(t==='home') showScreen('tab-home');
    if(t==='history') { showScreen('tab-history'); loadHistoryList(); }
}
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    const hideTabs = ['screen-timer','screen-interim','screen-paywall','screen-help'];
    document.getElementById('tab-bar').style.display = hideTabs.includes(id) ? 'none' : 'flex';
}
function openSettings() { document.getElementById('modal-settings').style.display='flex'; document.getElementById('apiKeyInput').value=localStorage.getItem('sf_api_key')||''; }
function saveSettings() { localStorage.setItem('sf_api_key', document.getElementById('apiKeyInput').value.trim()); document.getElementById('modal-settings').style.display='none'; }

// ==========================================
// NEW: 上传文件 + 激活校验逻辑
// ==========================================
const uploadInput = document.getElementById('audioUpload');

if (uploadInput) {
    uploadInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('audio/')) {
            showNiceAlert("格式不支持", "请上传音频文件", "📁");
            this.value = ''; 
            return;
        }

        // 1. 准备数据
        names.A = document.getElementById('nameA').value.trim() || "A";
        names.B = document.getElementById('nameB').value.trim() || "B";

        sessionSegments = [{
            blob: file,
            speaker: "Both",      
            role: "文件上传",      
            text: ""              
        }];

        // 2. 关键：暴力重置所有状态锁
        // 这能确保 startBatchProcessing 不会因为检测到旧状态而拒绝运行
        savedSessionId = null;
        isBatchStarted = false;
        isProcessingEnd = true; 

        // 3. 检查 VIP
        const isVip = localStorage.getItem('is_vip_user') === 'true';

        if (isVip) {
            showNiceAlert("文件已就绪", `文件名：${file.name}\n即将开始 AI 分析...`, "📂", () => {
                savedSessionId = null;  // 再次确保重置
                isBatchStarted = false;
                startBatchProcessing();
            });
        } else {
            // 去解锁页面，依靠上面的新版 verifyAndUnlock 来启动
            showScreen('screen-paywall');
        }

        this.value = '';
    });
}