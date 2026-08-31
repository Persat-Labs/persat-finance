#!/usr/bin/env node
/**
 * Build a single downloadable pitch PDF for GitHub.
 * Landscape 16:9-ish pages, Persat black/amber brand, slide images.
 */
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "Persat-Finance-Pitch-Deck-Testnet-Live.pdf");
const ASSETS = path.join(__dirname, "assets");

// 16:9 landscape points (1pt = 1/72")
const W = 960;
const H = 540;

const C = {
  bg: "#000000",
  ink: "#FFFFFF",
  muted: "#A7A7A7",
  dim: "#6E6E6E",
  orange: "#FF8A00",
  orange2: "#FFAA45",
  card: "#121212",
  stroke: "#2A2A2A",
};

const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const fontBold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const fontMono = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";

function img(name) {
  const p = path.join(ASSETS, name);
  return fs.existsSync(p) ? p : null;
}

function paintBg(doc, imageName) {
  doc.rect(0, 0, W, H).fill(C.bg);
  const p = imageName ? img(imageName) : null;
  if (p) {
    try {
      doc.image(p, 0, 0, { cover: [W, H], align: "center", valign: "center" });
    } catch {
      // ignore
    }
  }
  // dark veil for readability
  doc.save();
  doc.fillOpacity(0.78);
  doc.rect(0, 0, W * 0.62, H).fill(C.bg);
  doc.fillOpacity(0.45);
  doc.rect(W * 0.55, 0, W * 0.45, H).fill(C.bg);
  doc.restore();
  // amber edge accent
  doc.rect(0, 0, 4, H).fill(C.orange);
}

function foot(doc, n, total = 15) {
  doc.font(fontMono).fontSize(9).fillColor(C.dim);
  doc.text(`${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, W - 90, H - 28, {
    width: 70,
    align: "right",
  });
  doc.font(fontMono).fontSize(8).fillColor(C.dim);
  doc.text("PERSAT LABS", 28, H - 28);
}

function eyebrow(doc, t, x = 48, y = 40) {
  doc.font(fontMono).fontSize(10).fillColor(C.orange);
  doc.text(t.toUpperCase(), x, y, { characterSpacing: 1.5 });
}

function title(doc, lines, x = 48, y = 70, size = 28) {
  doc.font(fontBold).fontSize(size).fillColor(C.ink);
  let yy = y;
  for (const line of lines) {
    const isAccent = line.startsWith("§");
    const text = isAccent ? line.slice(1) : line;
    doc.fillColor(isAccent ? C.orange : C.ink);
    doc.text(text, x, yy, { width: W * 0.55, lineGap: 2 });
    yy += size + 8;
  }
  return yy;
}

function bullets(doc, items, x, y, width = W * 0.52) {
  let yy = y;
  for (const item of items) {
    doc.roundedRect(x, yy + 5, 6, 6, 1).fill(C.orange);
    doc.font(font).fontSize(12).fillColor("#E8E8E8");
    const h = doc.heightOfString(item, { width: width - 20, lineGap: 2 });
    doc.text(item, x + 16, yy, { width: width - 20, lineGap: 2 });
    yy += Math.max(h, 16) + 12;
  }
  return yy;
}

function card(doc, x, y, w, h, heading, bodyLines) {
  doc.roundedRect(x, y, w, h, 12).fill(C.card);
  doc.roundedRect(x, y, w, h, 12).strokeColor(C.stroke).lineWidth(1).stroke();
  doc.font(fontBold).fontSize(13).fillColor(C.orange2).text(heading, x + 16, y + 14, { width: w - 32 });
  let yy = y + 36;
  doc.font(font).fontSize(11).fillColor("#D0D0D0");
  for (const line of bodyLines) {
    doc.text("–  " + line, x + 16, yy, { width: w - 32, lineGap: 1 });
    yy += doc.heightOfString("–  " + line, { width: w - 32 }) + 6;
  }
}

function logo(doc) {
  const p = img("persatlogo.png");
  if (p) {
    try {
      doc.image(p, 48, 28, { height: 28 });
      return;
    } catch {
      //
    }
  }
  doc.font(fontBold).fontSize(14).fillColor(C.orange).text("PERSAT", 48, 32);
}

const doc = new PDFDocument({
  size: [W, H],
  margin: 0,
  info: {
    Title: "Persat Finance — Pitch Deck (Testnet Live)",
    Author: "Persat Labs",
    Subject: "Non-custodial Bitcoin-backed P2P credit — testnet live, 3-step mainnet path",
    Keywords: "Persat, Bitcoin, lending, Solana, testnet",
  },
});

const stream = fs.createWriteStream(OUT);
doc.pipe(stream);

// ─── 1 TITLE ───
paintBg(doc, "01-title-liquidity.jpg");
logo(doc);
eyebrow(doc, "Persat Finance · Persat Labs", 48, 78);
doc.font(fontBold).fontSize(32).fillColor(C.ink);
doc.text("You shouldn’t have to sell", 48, 105, { width: 520 });
doc.text("what you own just because", 48, 145, { width: 520 });
doc.fillColor(C.orange).text("you need liquidity.", 48, 185, { width: 520 });
doc.font(font).fontSize(14).fillColor("#E0E0E0");
doc.text("Testnet is live. Early users are in.\nMainnet is three disciplined steps away.", 48, 250, {
  width: 480,
  lineGap: 4,
});
doc.font(fontMono).fontSize(11).fillColor(C.orange).text("NEGOTIATE. LEND. EARN.", 48, 320, {
  characterSpacing: 2,
});
foot(doc, 1);

// ─── 2 WHY ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "02-why-choice.jpg");
eyebrow(doc, "Why");
title(doc, ["The choice feels", "§violent."], 48, 70, 30);
doc.font(font).fontSize(13).fillColor("#E8E8E8");
const why = [
  "A Bitcoin holder needs rent. An emergency hits. An opportunity appears.",
  "Sell the asset you believe in — or go without.",
  "Someone else has capital and wants to earn. Lending without trust is a gamble with no enforcement.",
  "The world doesn’t lack assets or capital. It lacks infrastructure that lets them meet without surrender.",
];
let y = 160;
for (const p of why) {
  doc.text(p, 48, y, { width: 500, lineGap: 3 });
  y += doc.heightOfString(p, { width: 500 }) + 14;
}
doc.font(fontBold).fontSize(14).fillColor(C.orange2);
doc.text("This is not a feature gap. It is a human dignity gap.", 48, y + 8, { width: 500 });
foot(doc, 2);

// ─── 3 SCAR ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "03-scar-custody.jpg");
eyebrow(doc, "The scar");
title(doc, ["We’ve already seen what", "“trust me with your coins”", "§costs."], 48, 65, 26);
bullets(
  doc,
  [
    "Centralized lenders asked for custody. History answered with freezes, failures, and vanished access.",
    "Celsius-class failures didn’t just lose money — they broke the story of being “safe” in crypto.",
    "The question that built Persat: why should liquidity require giving up control?",
    "Answer: non-custodial vaults, onchain agreements, collateral in cryptographically enforced structure.",
  ],
  48,
  200,
);
foot(doc, 3);

// ─── 4 TWO SIDES ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "04-two-sides.jpg");
eyebrow(doc, "One problem · two sides");
title(doc, ["Same wound.", "§Two stomachs."], 48, 65, 28);
card(doc, 48, 175, 280, 230, "Borrower", [
  "I hold value. I need cash. I refuse to sell my future.",
  "Selling under pressure abandons a thesis — not “taking profit.”",
  "I will not hand my stack to a black box to feel liquid.",
]);
card(doc, 348, 175, 280, 230, "Lender", [
  "I have capital. I want yield with spine.",
  "No vibes, DMs, or promises without collateral and rules.",
  "I need discovery, verification, and enforcement — not hope.",
]);
doc.font(fontBold).fontSize(13).fillColor(C.ink).text("Persat is the infrastructure between them.", 48, 430, {
  width: 600,
});
foot(doc, 4);

// ─── 5 PRODUCT ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "05-marketplace-trust.jpg");
eyebrow(doc, "Identity");
title(doc, ["The marketplace and trust layer", "for §onchain credit."], 48, 65, 26);
bullets(
  doc,
  [
    "Peer-to-peer by design — people still meet; the protocol enforces the deal.",
    "Two doors, one lifecycle — private direct deals + open marketplace.",
    "Discovery · negotiation · collateral · escrow · terms · settlement · repayment · liquidation.",
    "We don’t eliminate the relationship. We give the relationship armor.",
  ],
  48,
  185,
);
// chips
const chips = ["BTC collateral · tBTC / zBTC", "Loans · USDC / USDT", "Solana · non-custodial"];
let cx = 48;
doc.font(fontMono).fontSize(9);
for (const c of chips) {
  const tw = doc.widthOfString(c) + 20;
  doc.roundedRect(cx, 400, tw, 22, 11).fill("#1A1208");
  doc.roundedRect(cx, 400, tw, 22, 11).strokeColor(C.orange).lineWidth(0.8).stroke();
  doc.fillColor(C.orange2).text(c, cx + 10, 406);
  cx += tw + 10;
}
foot(doc, 5);

// ─── 6 JOURNEY ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "06-journey.jpg");
eyebrow(doc, "How it feels");
title(doc, ["From need → capital", "§without the surrender."], 48, 65, 26);
const steps = [
  ["01", "Connect wallet. State what you need — or what you’ll lend."],
  ["02", "Agree terms with a counterparty (private link or marketplace)."],
  ["03", "Lock eligible BTC-collateral in a non-custodial vault."],
  ["04", "Fund. Activate. Live the loan."],
  ["05", "Repay and release — or default path with rules, not chaos."],
];
y = 175;
for (const [n, t] of steps) {
  doc.font(fontMono).fontSize(11).fillColor(C.orange).text(n, 48, y);
  doc.font(font).fontSize(13).fillColor("#E8E8E8").text(t, 88, y, { width: 480 });
  y += 36;
}
doc.font(fontBold).fontSize(12).fillColor(C.orange2).text("Neither side relies only on the other’s goodwill.", 48, y + 8);
foot(doc, 6);

// ─── 7 WEDGE ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "07-bitcoin-wedge.jpg");
eyebrow(doc, "Wedge → destination");
title(doc, ["Bitcoin is our wedge.", "§Credit is our destination."], 48, 65, 28);
bullets(
  doc,
  [
    "We pilot on Bitcoin because it is liquid, global, and emotionally charged.",
    "Not a Bitcoin-lending brand forever — secured P2P credit infrastructure.",
    "Path: Bitcoin → broader digital collateral → multi-asset → asset-agnostic rails.",
    "Own the infrastructure layer — not every dollar of the market.",
  ],
  48,
  185,
);
const pathLabels = ["Bitcoin", "Digital assets", "Multi-asset", "Asset-agnostic"];
cx = 48;
y = 400;
doc.font(fontMono).fontSize(10);
for (let i = 0; i < pathLabels.length; i++) {
  const lab = pathLabels[i];
  doc.fillColor(i === pathLabels.length - 1 ? C.orange : C.muted).text(lab, cx, y);
  cx += doc.widthOfString(lab) + 8;
  if (i < pathLabels.length - 1) {
    doc.fillColor(C.dim).text("→", cx, y);
    cx += 18;
  }
}
foot(doc, 7);

// ─── 8 TESTNET LIVE ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "08-testnet-live.jpg");
doc.circle(56, 48, 5).fill("#34D399");
doc.font(fontMono).fontSize(10).fillColor(C.orange).text("LIVE NOW", 68, 42, { characterSpacing: 1.5 });
title(doc, ["Testnet just went live.", "The real work begins:", "§people."], 48, 70, 28);
bullets(
  doc,
  [
    "Early users onboarded to run real flows — borrow-side and lend-side.",
    "Not slideware. A live environment to break, measure, and harden.",
    "Full lifecycle pressure: propose, fund, repay, edge cases.",
    "If you’ve felt the sell-or-suffer choice, you belong in the first wave.",
  ],
  48,
  210,
);
foot(doc, 8);

// ─── 9 THREE STEPS ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "09-three-steps.jpg");
eyebrow(doc, "Mainnet path");
title(doc, ["Mainnet isn’t a rewrite.", "§Three disciplined steps after proof."], 48, 60, 24);
const three = [
  ["01", "Cluster & RPC", "Mainnet-grade connectivity, monitoring, production RPC."],
  ["02", "Canonical rails", "Real tBTC / zBTC / USDC / USDT. Freeze architecture under test."],
  ["03", "Production ops", "Dedicated keeper keys, strip testnet-only surfaces, governance posture."],
];
three.forEach((t, i) => {
  const x = 48 + i * 230;
  doc.roundedRect(x, 180, 215, 160, 12).fill(C.card);
  doc.roundedRect(x, 180, 215, 160, 12).strokeColor("#3A2A10").lineWidth(1).stroke();
  doc.font(fontMono).fontSize(11).fillColor(C.orange).text(t[0], x + 16, 196);
  doc.font(fontBold).fontSize(14).fillColor(C.ink).text(t[1], x + 16, 220, { width: 180 });
  doc.font(font).fontSize(11).fillColor("#C8C8C8").text(t[2], x + 16, 250, { width: 180, lineGap: 2 });
});
doc.font(fontBold).fontSize(12).fillColor(C.ink);
doc.text("Testnet exists to make those three steps boring — because boring is how credit infrastructure should ship.", 48, 370, {
  width: 700,
});
doc.font(font).fontSize(10).fillColor(C.dim);
doc.text("Audit-grade evidence and security gates before public real-funds promotion.", 48, 410, { width: 700 });
foot(doc, 9);

// ─── 10 WHITE SPACE ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "10-whitespace.jpg");
eyebrow(doc, "Positioning");
title(doc, ["Not another pool.", "Not another custodian.", "§Not a handshake with no teeth."], 48, 60, 24);
const cols = [
  ["Private lending", "Trust the person. Enforcement is social or slow."],
  ["DeFi pools", "Trust the algorithm. No negotiation. Pure machine."],
  ["Persat", "Discover the counterparty + structure the relationship + secure the transaction."],
];
cols.forEach((c, i) => {
  const x = 48 + i * 230;
  const hl = i === 2;
  doc.roundedRect(x, 200, 215, 150, 12).fill(hl ? "#1A1208" : C.card);
  doc
    .roundedRect(x, 200, 215, 150, 12)
    .strokeColor(hl ? C.orange : C.stroke)
    .lineWidth(hl ? 1.2 : 1)
    .stroke();
  doc.font(fontBold).fontSize(13).fillColor(C.orange2).text(c[0], x + 16, 220, { width: 180 });
  doc.font(font).fontSize(11).fillColor("#D0D0D0").text(c[1], x + 16, 250, { width: 180, lineGap: 2 });
});
doc.font(fontBold).fontSize(12).fillColor(C.ink);
doc.text("White space: P2P credit discovery × onchain secured enforcement.", 48, 380, { width: 700 });
foot(doc, 10);

// ─── 11 MARKET (panel) ───
doc.addPage({ size: [W, H], margin: 0 });
doc.rect(0, 0, W, H).fill(C.bg);
doc.rect(0, 0, 4, H).fill(C.orange);
// subtle glow
doc.save();
doc.fillOpacity(0.12);
doc.circle(120, 80, 160).fill(C.orange);
doc.restore();
eyebrow(doc, "Market");
title(doc, ["Trillions sit idle — not from apathy,", "from §missing rails."], 48, 70, 26);
doc.roundedRect(48, 180, 280, 200, 14).fill("#1A1208");
doc.roundedRect(48, 180, 280, 200, 14).strokeColor(C.orange).lineWidth(1).stroke();
doc.font(fontMono).fontSize(10).fillColor(C.orange).text("DIRECTION", 68, 200);
doc.font(fontBold).fontSize(22).fillColor(C.ink).text("Idle digital capital", 68, 230, { width: 240 });
doc
  .font(font)
  .fontSize(12)
  .fillColor(C.muted)
  .text("Bitcoin and stables represent enormous value that cannot safely become credit without custody or chaos.", 68, 290, {
    width: 240,
    lineGap: 3,
  });
bullets(
  doc,
  [
    "Idle capital is frozen intention: liquidity and yield without self-betrayal.",
    "Strategy: BTC-backed P2P wedge → multi-asset → asset-agnostic rails.",
    "Own the infrastructure layer — not the whole pie.",
    "Estimates are directional research — not claims of capture.",
  ],
  360,
  180,
  520,
);
foot(doc, 11);

// ─── 12 FOUNDERS ───
doc.addPage({ size: [W, H], margin: 0 });
doc.rect(0, 0, W, H).fill(C.bg);
doc.rect(0, 0, 4, H).fill(C.orange);
eyebrow(doc, "Origin");
title(doc, ["Built by people who", "§felt the trap."], 48, 70, 28);
card(doc, 48, 175, 400, 220, "David Obiokafor — Founder & CEO", [
  "Lived the “I need liquidity against BTC” problem.",
  "Rejected custody as the price of access.",
  "Years refining marketplace + trust layer.",
  "Problem conviction · research · iteration leadership.",
]);
card(doc, 470, 175, 400, 220, "Prince N. Michael — Co-founder & CTO", [
  "Turned conviction into executable product and architecture.",
  "Robotics & AI builder background.",
  "Product · architecture · shipping.",
  "Technical spine of Persat.",
]);
doc.font(fontBold).fontSize(13).fillColor(C.orange2);
doc.text("Domain scar tissue + technical spine. Not tourists in the problem.", 48, 430, { width: 800 });
foot(doc, 12);

// ─── 13 TEAM ───
doc.addPage({ size: [W, H], margin: 0 });
doc.rect(0, 0, W, H).fill(C.bg);
doc.rect(0, 0, 4, H).fill(C.orange);
logo(doc);
eyebrow(doc, "Team", 48, 80);
doc.font(fontBold).fontSize(28).fillColor(C.ink);
doc.text("Domain conviction + ", 48, 110);
doc.fillColor(C.orange).text("technical execution.", 48, 148);
const team = [
  ["DO", "David Obiokafor", "Founder & CEO", "Problem conviction · research · iteration"],
  ["PN", "Prince N. Michael", "Co-founder & CTO", "Product · architecture · shipping"],
];
team.forEach((t, i) => {
  const x = 48 + i * 320;
  doc.roundedRect(x, 230, 300, 180, 14).fill(C.card);
  doc.roundedRect(x, 230, 300, 180, 14).strokeColor("#3A2A10").lineWidth(1).stroke();
  doc.roundedRect(x + 122, 250, 56, 56, 12).fill("#2A1A08");
  doc.font(fontBold).fontSize(14).fillColor(C.orange).text(t[0], x + 122, 268, { width: 56, align: "center" });
  doc.font(fontBold).fontSize(14).fillColor(C.ink).text(t[1], x + 20, 325, { width: 260, align: "center" });
  doc.font(fontMono).fontSize(9).fillColor(C.orange).text(t[2].toUpperCase(), x + 20, 350, {
    width: 260,
    align: "center",
  });
  doc.font(font).fontSize(11).fillColor(C.muted).text(t[3], x + 20, 375, { width: 260, align: "center" });
});
foot(doc, 13);

// ─── 14 ASK ───
doc.addPage({ size: [W, H], margin: 0 });
doc.rect(0, 0, W, H).fill(C.bg);
doc.rect(0, 0, 4, H).fill(C.orange);
eyebrow(doc, "The door");
title(doc, ["Get in before credit gets", "§rebuilt without you."], 48, 70, 28);
doc.roundedRect(48, 175, 400, 160, 14).fill("#1A1208");
doc.roundedRect(48, 175, 400, 160, 14).strokeColor(C.orange).lineWidth(1.2).stroke();
doc.font(fontBold).fontSize(16).fillColor(C.orange2).text("Early users", 68, 195);
doc
  .font(font)
  .fontSize(12)
  .fillColor("#E0E0E0")
  .text("Join testnet onboarding. Borrow or lend in a controlled live environment. Help forge the rails you’ll want on mainnet.", 68, 230, {
    width: 360,
    lineGap: 3,
  });
doc.roundedRect(470, 175, 400, 160, 14).fill(C.card);
doc.roundedRect(470, 175, 400, 160, 14).strokeColor(C.stroke).lineWidth(1).stroke();
doc.font(fontBold).fontSize(16).fillColor(C.orange2).text("Partners & capital", 490, 195);
doc
  .font(font)
  .fontSize(12)
  .fillColor("#E0E0E0")
  .text("Aligned partners who understand credit infrastructure is earned in public testnet, then cut over with discipline.", 490, 230, {
    width: 360,
    lineGap: 3,
  });
const mile = ["Live testnet", "Early cohort proof", "Audit-grade gates", "3-step mainnet", "Scale"];
cx = 48;
y = 380;
doc.font(fontMono).fontSize(10);
mile.forEach((m, i) => {
  doc.fillColor(i === mile.length - 1 ? C.orange : C.muted).text(m, cx, y);
  cx += doc.widthOfString(m) + 6;
  if (i < mile.length - 1) {
    doc.fillColor(C.dim).text("→", cx, y);
    cx += 16;
  }
});
foot(doc, 14);

// ─── 15 CLOSE ───
doc.addPage({ size: [W, H], margin: 0 });
paintBg(doc, "01-title-liquidity.jpg");
logo(doc);
doc.font(fontBold).fontSize(30).fillColor(C.ink);
doc.text("Keep what you believe in.", 48, 120, { width: 600 });
doc.text("Access what you need.", 48, 160, { width: 600 });
doc.fillColor(C.orange).text("Enforce what you agree.", 48, 200, { width: 600 });
doc.font(font).fontSize(14).fillColor("#E0E0E0");
doc.text("Persat Finance — the marketplace and trust layer for onchain credit.", 48, 270, { width: 520 });
doc.text("Testnet live. Early users welcome.\nMainnet, three steps after the truth comes back from the field.", 48, 300, {
  width: 520,
  lineGap: 4,
});
doc.font(fontMono).fontSize(11).fillColor(C.orange2);
doc.text("persat.ng@gmail.com  ·  persat.finance  ·  dapp.persat.finance", 48, 380);
doc.font(fontMono).fontSize(11).fillColor(C.orange).text("PERSAT LABS", 48, 420, { characterSpacing: 2 });
foot(doc, 15);

doc.end();

await new Promise((resolve, reject) => {
  stream.on("finish", resolve);
  stream.on("error", reject);
});

const st = fs.statSync(OUT);
console.log(`Wrote ${OUT}`);
console.log(`Size: ${(st.size / 1024).toFixed(1)} KB`);
