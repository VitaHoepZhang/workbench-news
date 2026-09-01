// scripts/fetch-news.mjs — GitHub Actions 云端自动抓取资讯（零依赖，Node 22 原生 fetch）
// 数据源均为 GitHub 海外服务器可稳定访问的接口（国内反爬接口如微博/知乎/B站已排除）
// 产出：news.json / finance-news.json / version.json（提交回仓库，前端经 jsdelivr CDN 拉取）
// 任何数据源失败都自动降级，保证 JSON 永远合法可解析
import { writeFileSync, readFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const OUT = process.cwd().endsWith("scripts") ? process.cwd() + "/../" : process.cwd() + "/";

async function get(url, opt = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "*/*", "Referer": opt.ref || "https://www.baidu.com/", ...(opt.headers || {}) },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return opt.text ? await res.text() : await res.json();
  } finally { clearTimeout(t); }
}

const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[m])).trim();

// ---------- 热榜 ----------

// 百度热搜（海外可访问）
async function fetchBaidu() {
  try {
    const d = await get("https://top.baidu.com/api/board?platform=wise&tab=realtime");
    const list = d.data?.cards?.[0]?.content?.[0]?.content || [];
    return list.slice(0, 12).map((x) => ({
      title: x.word || "", hot: x.hotScore ? String(x.hotScore) : "热",
      url: x.url || "", desc: "",
    })).filter((x) => x.title);
  } catch (e) { console.log("baidu 降级:", e.message); return []; }
}

// 头条热榜（海外可访问）
async function fetchToutiao() {
  try {
    const d = await get("https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc");
    return (d.data || []).slice(0, 10).map((x) => ({
      title: x.Title || "", hot: x.HotValue ? String(x.HotValue) : "热",
      url: x.Url || "", desc: "",
    })).filter((x) => x.title);
  } catch (e) { console.log("toutiao 降级:", e.message); return []; }
}

// 60s 当日要闻（含解读文本）
async function fetch60s() {
  try {
    const d = await get("https://60s.viki.moe/v2/60s");
    return (d.data?.news || []).slice(0, 10).map((txt, i) => ({
      title: String(txt).split("，")[0].slice(0, 24),
      summary: String(txt),
      source: "60s读懂世界", url: "", category: "要闻", heat: "中",
    })).filter((x) => x.title);
  } catch (e) { console.log("60s 降级:", e.message); return []; }
}

// ---------- RSS 科技资讯 ----------

async function fetchRss(url, source, n) {
  try {
    const xml = await get(url, { text: true });
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, n).map((m) => {
      const t = m[1].match(/<title>([\s\S]*?)<\/title>/);
      const l = m[1].match(/<link>([\s\S]*?)<\/link>/);
      const d = m[1].match(/<description>([\s\S]*?)<\/description>/) || m[1].match(/<content:encoded>([\s\S]*?)<\/content:encoded>/);
      return {
        title: stripHtml(t ? t[1] : ""),
        url: (l ? l[1] : "").trim(),
        summary: stripHtml(d ? d[1] : "").slice(0, 120),
      };
    }).filter((x) => x.title);
    return items.map((x) => ({ ...x, source, category: "科技", heat: "高" }));
  } catch (e) { console.log(source, "降级:", e.message); return []; }
}

// ---------- 财经 ----------

// 东方财富指数（fltt=2 直接小数）
async function fetchIndices() {
  try {
    const d = await get("https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001,0.399006&fields=f2,f3,f4,f12,f14", { ref: "https://quote.eastmoney.com/" });
    return (d.data?.diff || []).map((x) => ({
      name: x.f14, value: x.f2, change: x.f4, pct: x.f3,
    })).filter((x) => x.name);
  } catch (e) { console.log("em 指数降级:", e.message); return []; }
}

// 东方财富行业板块涨跌幅
async function fetchSectors() {
  try {
    const d = await get("https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=8&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f3,f14", { ref: "https://quote.eastmoney.com/" });
    return (d.data?.diff || []).map((x) => ({ name: x.f14, change: x.f3 })).filter((x) => x.name);
  } catch (e) { console.log("em 板块降级:", e.message); return []; }
}

// ---------- AI 科普（可选：配置 DEEPSEEK_API_KEY 后启用） ----------
async function genWithAI(hot, type) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  try {
    const topics = hot.slice(0, 8).map((h) => h.title).join("；");
    const tasks = {
      science: "为其中最有科普价值的 4 条各写一段通俗解读，输出 JSON 数组 [{\"title\":\"通俗标题\",\"summary\":\"2-3 句解释背景与原理\",\"source\":\"科普\",\"heat\":\"高\"}]",
      legal: "识别其中与法律相关的热点（若无则写劳动法/消费维权等大众常见法律话题），输出 JSON 数组 [{\"title\":\"法律速递标题\",\"summary\":\"2-3 句法律知识解读\",\"source\":\"普法\",\"heat\":\"高\"}] 最多 3 条",
    };
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: `以下是今天的全网热点：${topics}\n请${tasks[type]}。只输出 JSON，不要多余文字。` }],
        temperature: 0.7, max_tokens: 900,
      }),
    });
    if (!res.ok) throw new Error("AI HTTP " + res.status);
    const d = await res.json();
    const txt = d.choices?.[0]?.message?.content || "";
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.slice(0, 4) : [];
  } catch (e) { console.log("AI 生成降级:", e.message); return []; }
}

// ---------- 规则兜底（AI 不可用/失败时保证板块非空） ----------

// 法律关键词：热点标题命中任一即视为法律相关
const LEGAL_KWS = ["裁员","辞退","劳动","加班","工资","欠薪","合同","租房","押金","维权","赔偿","罚款","起诉","判决","法院","犯罪","诈骗","诈骗罪","股权","社保","公积金","个税","婚姻","继承","酒驾","违章","投诉","消费者","网购","贷款","借贷","拘留","被捕","受贿","反腐","事故责任","商标","版权","隐私","泄露"];
// 内置大众法律话题模板（无法律热点时兜底展示）
const LEGAL_TEMPLATES = [
  { title: "被裁员，经济补偿 N / N+1 / 2N 怎么算？", summary: "经济补偿按工作年限算：每满一年一个月工资（N）；无过失性辞退未提前 30 天通知加一个月（N+1）；违法解除按二倍（2N）。", source: "普法", heat: "高" },
  { title: "买到问题商品，消费者维权的 3 条路", summary: "先与商家协商；协商不成可向 12315 投诉；数额较大可起诉。网购 7 天无理由退货是法定权利。", source: "普法", heat: "高" },
  { title: "加班费三档标准：1.5 / 2 / 3 倍", summary: "工作日延时 150%、休息日不补休 200%、法定节假日 300%。保留加班记录是维权关键证据。", source: "普法", heat: "高" },
];
function legalFallback(hot) {
  const hit = hot.filter((h) => LEGAL_KWS.some((kw) => (h.title || "").includes(kw))).slice(0, 3)
    .map((h) => ({ title: "「" + h.title + "」涉及哪些法律点？", summary: "该热点与上述法律关键词相关，具体法律定性以官方通报为准；涉及劳动/消费/合同纠纷可先咨询 12348 法律援助热线。", source: "普法", heat: "高", url: h.url || "" }));
  return hit.length ? hit : LEGAL_TEMPLATES;
}
// 科普兜底：无 AI 且 60s 源失败时，用今日热点生成速览
function scienceFallback(hot) {
  return hot.slice(0, 4).map((h, i) => ({
    title: "今日热点速览 · " + (h.title || "要闻" + (i + 1)),
    summary: "「" + (h.title || "") + "」为今日高热度话题，点击热榜可查看详情；持续关注权威媒体报道可了解最新进展。",
    source: "热点速览", heat: "高",
  }));
}

// ---------- 主流程 ----------
const [bd, tt, news60] = await Promise.all([fetchBaidu(), fetchToutiao(), fetch60s()]);
const [ithome, sspai] = await Promise.all([
  fetchRss("https://www.ithome.com/rss/", "IT之家", 6),
  fetchRss("https://sspai.com/feed", "少数派", 6),
]);

// 合并热榜（去重、限 15 条）
const seen = new Set();
const hot = [...bd, ...tt].filter((h) => {
  if (!h.title || seen.has(h.title)) return false;
  seen.add(h.title); return true;
}).slice(0, 15).map((h, i) => ({ rank: i + 1, ...h }));

// 科普：优先 AI 生成；无 key/失败用 60s 要闻解读兜底；再失败用热点速览
const scienceAI = await genWithAI(hot, "science");
const science = scienceAI && scienceAI.length ? scienceAI
  : (news60.length ? news60.slice(0, 4).map((x) => ({
      title: x.title, summary: x.summary, source: "60s读懂世界", url: "", heat: "中",
    })) : scienceFallback(hot));

// 法律速递：优先 AI；无 key/失败用规则兜底（关键词匹配热点 → 内置模板），保证板块永不为空
const legalAI = await genWithAI(hot, "legal");
const legal = legalAI && legalAI.length ? legalAI : legalFallback(hot);

// 选题建议（模板）
const suggested = hot.slice(0, 5).map((h) => ({
  title: h.title, reason: "今日热点，可做背景梳理与深度解读",
}));

const nowISO = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "+08:00");

const news = {
  updated_at: nowISO,
  science,
  tech_briefing: { items: ithome },
  mzu_briefing: { items: [...news60, ...sspai] },
  legal_briefing: { items: legal },
  hot_topics: hot.map((h) => ({ title: h.title, platform: "百度热搜/头条", hot: h.hot || "", url: h.url || "" })),
  suggested_topics: suggested,
};

const [indices, sectors] = await Promise.all([fetchIndices(), fetchSectors()]);
const finance = {
  updated_at: nowISO,
  indices,
  sectors,
  macro: [],
  policy: [],
  watch: [],
};

const ver = { version: nowISO.slice(0, 10).replace(/-/g, "") + "-" + nowISO.slice(11, 16).replace(":", "") };

writeFileSync(OUT + "news.json", JSON.stringify(news, null, 2), "utf8");
writeFileSync(OUT + "finance-news.json", JSON.stringify(finance, null, 2), "utf8");
writeFileSync(OUT + "version.json", JSON.stringify(ver, null, 2), "utf8");

console.log("✅ 生成完成 @", nowISO);
console.log("  hot_topics:", hot.length, "条 | science:", science.length, "条 | tech:", ithome.length + sspai.length, "条 | mzu:", news60.length + sspai.length, "条 | legal:", legal.length, "条");
console.log("  indices:", JSON.stringify(indices.map((x) => x.name + " " + x.value + " (" + x.pct + "%)")), "| sectors:", sectors.length, "个");
console.log("  version:", ver.version);
JSON.parse(readFileSync(OUT + "news.json", "utf8"));
JSON.parse(readFileSync(OUT + "finance-news.json", "utf8"));
console.log("  JSON 校验通过 ✅");
