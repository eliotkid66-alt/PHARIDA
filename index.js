const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const BOT_NAME = "CyberShade-bot";
const PREFIX = ".";
const ownerNumber = "241077568261@s.whatsapp.net";

// Photo de profil du bot (image locale dans le repo, plus fiable qu'un lien)
const PROFILE_PICTURE = path.join(__dirname, "profile.jpg");
const PROFILE_URL = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTSbBnrJ4jGj7JC9J292KQiq0amzwYZWOWOn7zOjm35mSjQKzq9tL__9sw&s";

const logger = pino({ level: "silent" });

// Télécharge la photo si absente du repo
async function ensureProfilePicture() {
  if (fs.existsSync(PROFILE_PICTURE)) return PROFILE_PICTURE;
  try {
    const res = await axios.get(PROFILE_URL, { responseType: "arraybuffer" });
    fs.writeFileSync(PROFILE_PICTURE, res.data);
    return PROFILE_PICTURE;
  } catch (e) {
    console.log("Impossible de télécharger la photo :", e.message);
    return null;
  }
}

async function setBotPicture(sock) {
  const img = await ensureProfilePicture();
  if (!img) return;
  try {
    await sock.updateProfilePicture(sock.user.id, { url: img });
    console.log(`[${BOT_NAME}] Photo de profil définie ✔`);
  } catch (e) {
    console.log("Erreur photo de profil :", e.message);
  }
}

async function startBot() {
  const sessionDir = path.join(__dirname, "session");
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    browser: ["CyberShade-bot", "Chrome", "1.0.0"],
    auth: state,
    markOnlineOnConnect: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log(`\n[${BOT_NAME}] Scanne le QR avec WhatsApp > Appareils connectés`);
      try {
        const number = process.env.PAIR_NUMBER || "241077568261";
        if (number && !sock.authState.creds.registered) {
          const code = await sock.requestPairingCode(number);
          console.log(`\n[${BOT_NAME}] CODE DE JUMELAGE : ${code}`);
        }
      } catch (e) { console.log("Pairing code indisponible :", e.message); }
    }

    if (connection === "open") {
      console.log(`[${BOT_NAME}] Connecté avec succès ✔`);
      await setBotPicture(sock); // définit la photo automatiquement
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log(`[${BOT_NAME}] Session déconnectée, suppression de la session...`);
        fs.rmSync(sessionDir, { recursive: true, force: true });
        startBot();
      } else {
        console.log(`[${BOT_NAME}] Reconnexion en cours...`);
        startBot();
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const m = messages[0];
    if (!m.message) return;

    const jid = m.key.remoteJid;
    const sender = m.key.participant || jid;
    const isOwner = sender === ownerNumber;

    const body =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message.imageMessage?.caption ||
      "";

    if (!body.startsWith(PREFIX)) return;
    const args = body.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: m });

    switch (cmd) {
      case "ping": {
        const t = Date.now();
        await sock.sendMessage(jid, { text: "Pong !" }, { quoted: m });
        return reply(`*${BOT_NAME}* ⚡\nLatence : ${Date.now() - t} ms`);
      }

      case "menu":
        return reply(
`╭─「 *${BOT_NAME}* 」
│ ⚡ ${PREFIX}ping — tester la latence
│ ⚡ ${PREFIX}menu — afficher ce menu
│ ⚡ ${PREFIX}info — infos du bot
│ ⚡ ${PREFIX}id — ID du chat
│ ⚡ ${PREFIX}owner — contact du propriétaire
╰────────────`
      );

      case "info":
        return reply(
`*${BOT_NAME}* v1.0.0
⚙️ Baileys (Node.js)
👑 Owner : wa.me/241077568261
💻 Plateforme : ${process.platform}
⏱️ Uptime : ${Math.floor(process.uptime())}s
🧠 RAM : ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`
      );

      case "id":
        return reply(`ID du chat : \`${jid}\`\nTon ID : \`${sender}\``);

      case "owner":
        return reply(`Owner : wa.me/241077568261`);

      case "broadcast": {
        if (!isOwner) return reply("❌ Commande réservée au owner.");
        const text = args.join(" ");
        if (!text) return reply("Usage : .broadcast <message>");
        const chats = await sock.groupFetchAllParticipating();
        const groups = Object.values(chats).map((g) => g.id);
        for (const g of groups) {
          await sock.sendMessage(g, { text: `📢 *${BOT_NAME}*\n\n${text}` });
          await new Promise((r) => setTimeout(r, 1500));
        }
        return reply(`✅ Envoyé à ${groups.length} groupes.`);
      }

      default:
        return reply(`Commande inconnue : *${cmd}*\nTape ${PREFIX}menu`);
    }
  });
}

startBot();