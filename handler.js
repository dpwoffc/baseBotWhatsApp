import fs from "fs";
import path from "path";
import { text } from "stream/consumers";
import { fileURLToPath } from "url";
import { downloadContentFromMessage } from "ourin-baileys/lib/Utils/messages-media.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SETTINGS_PATH = path.join(__dirname, "settings.json");
const GROUP_ACCESS_PATH = path.join(__dirname, "database", "grupAccess.json");

function loadJSON(file, fallback = {}) {
    try {
        if (!fs.existsSync(file)) return fallback;

        const data = fs.readFileSync(file, "utf8");
        return JSON.parse(data);
    } catch (err) {
        console.error(`❌ Gagal membaca ${file}:`, err.message);
        return fallback;
    }
}

function getSettings() {
    return loadJSON(SETTINGS_PATH, {
        ownerNumber: []
    });
}

function getGroupAccess() {
    const data = loadJSON(GROUP_ACCESS_PATH, []);

    if (Array.isArray(data)) {
        return data;
    }

    if (Array.isArray(data.groups)) {
        return data.groups;
    }

    return [];
}

function normalizeNumber(number) {
    if (!number) return "";

    return String(number)
        .replace(/@s.whatsapp.net/g, "")
        .replace(/@c.us/g, "")
        .replace(/\D/g, "");
}

function normalizeGroupJid(jid) {
    if (!jid) return "";

    return String(jid).trim().toLowerCase();
}

function isOwner(sender) {
    const settings = getSettings();
    const ownerNumber = settings.ownerNumber;

    const owners = Array.isArray(ownerNumber)
        ? ownerNumber
        : [ownerNumber];

    const senderNumber = normalizeNumber(sender);

    return owners.some(owner => {
        return normalizeNumber(owner) === senderNumber;
    });
}

function isGroupAllowed(groupJid) {
    const groups = getGroupAccess();
    const jid = normalizeGroupJid(groupJid);

    return groups.some(group => {
        if (typeof group === "string") {
            return normalizeGroupJid(group) === jid;
        }

        if (group && typeof group === "object") {
            return normalizeGroupJid(
                group.id || group.jid || group.groupId
            ) === jid;
        }

        return false;
    });
}

function checkAccess(m) {
    const settings = getSettings();
    const ownerNumber = settings.ownerNumber;

    const sender =
        m.sender ||
        m.key?.participant ||
        m.participant ||
        m.key?.remoteJid;

    const remoteJid =
        m.chat ||
        m.from ||
        m.key?.remoteJid;

    const isGroup =
        remoteJid?.endsWith("@g.us") ||
        m.isGroup === true;

    if (isGroup) {
        const groupJid = normalizeGroupJid(
            remoteJid
        );

        if (!isGroupAllowed(groupJid)) {
            return false;
        }

        return true;
    }

    if (isOwner(sender)) {
        return true;
    }

    return false;
}

const fakeQuote = {
    key: {
        fromMe: false,
        participant: '0@s.whatsapp.net',
        remoteJid: 'status@broadcast'
    },
    message: {
        imageMessage: {
            text: '@itcsneka',
            caption: '@itcsneka'
        }
    }
}

const listMenu = [
    {
        name: "single_select",
        buttonParamsJson: JSON.stringify({
            title: "Lihat Daftar Fitur",
            sections: [
                {
                    title: "OPERASIONAL",
                    rows: [
                        {
                            title: "📅 Jadwal Rutin",
                            description: "Lihat agenda kumpul mingguan",
                            id: ".jadwalrutin"
                        },
                        {
                            title: "👑 Info Developer",
                            description: "Informasi kontak ITCSNEKA",
                            id: ".owner"
                        }
                    ]
                },
                {
                    title: "SISTEM",
                    rows: [
                        {
                            title: "🏓 Bot Connection Check",
                            description: "Cek koneksi bot",
                            id: ".ping"
                        }
                    ]
                }
            ]
        })
    }
];

async function downloadQuotedMedia(quoted) {
    const message = quoted.message;

    let media;
    let type;

    if (message.imageMessage) {
        media = message.imageMessage;
        type = "image";
    } else if (message.videoMessage) {
        media = message.videoMessage;
        type = "video";
    } else if (message.audioMessage) {
        media = message.audioMessage;
        type = "audio";
    } else if (message.documentMessage) {
        media = message.documentMessage;
        type = "document";
    } else if (message.stickerMessage) {
        media = message.stickerMessage;
        type = "sticker";
    } else {
        throw new Error("Pesan yang direply bukan media.");
    }

    const stream = await downloadContentFromMessage(
        media,
        type
    );

    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

async function handler(sock, m) {
    if (!checkAccess(m)) {
        return;
    }

    const remoteJid =
        m.chat ||
        m.from ||
        m.key?.remoteJid;

    const sender =
        m.sender ||
        m.key?.participant ||
        m.participant ||
        remoteJid;

    const isGroup =
        remoteJid?.endsWith("@g.us") ||
        m.isGroup === true;

    let body =
        m.body ||
        m.text ||
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        "";

const msg = m.message;

// ===============================
// DETEKSI PESAN YANG DI-REPLY
// ===============================
const contextInfo =
    msg?.extendedTextMessage?.contextInfo ||
    msg?.imageMessage?.contextInfo ||
    msg?.videoMessage?.contextInfo ||
    msg?.audioMessage?.contextInfo ||
    msg?.documentMessage?.contextInfo ||
    msg?.stickerMessage?.contextInfo ||
    msg?.buttonsResponseMessage?.contextInfo ||
    msg?.listResponseMessage?.contextInfo ||
    msg?.templateButtonReplyMessage?.contextInfo ||
    msg?.interactiveResponseMessage?.contextInfo;

const quotedMessage = contextInfo?.quotedMessage;

if (quotedMessage) {
    m.quoted = {
        message: quotedMessage,
        key: {
            remoteJid: m.key?.remoteJid,
            fromMe: contextInfo.participant === m.key?.participant,
            id: contextInfo.stanzaId,
            participant: contextInfo.participant
        },

        // TEXT
        text:
            quotedMessage.conversation ||
            quotedMessage.extendedTextMessage?.text ||
            quotedMessage.imageMessage?.caption ||
            quotedMessage.videoMessage?.caption ||
            quotedMessage.documentMessage?.caption ||
            "",

        // TYPE
        mtype: Object.keys(quotedMessage)[0],

        // MEDIA
        imageMessage: quotedMessage.imageMessage,
        videoMessage: quotedMessage.videoMessage,
        audioMessage: quotedMessage.audioMessage,
        documentMessage: quotedMessage.documentMessage,
        stickerMessage: quotedMessage.stickerMessage,

        // CAPTION
        caption:
            quotedMessage.imageMessage?.caption ||
            quotedMessage.videoMessage?.caption ||
            quotedMessage.documentMessage?.caption ||
            "",

        // PTT
        ptt: quotedMessage.audioMessage?.ptt || false
    };
}

    const command =
        body
            .trim()
            .split(/\s+/)[0]
            ?.toLowerCase() || "";

    const args = body
        .trim()
        .split(/\s+/)
        .slice(1);

    switch (command) {
        case '.itc': {
            try {
                await sock.sendMessage(
                    remoteJid,
                    {
                        interactiveMessage: {
                            header: "✦ *ITCSNEKA DASHBOARD* ✦",
                            title: "Halo, Selamat Datang\n\nSilahkan gunakan fitur yang ada",
                            body: "@itcsneka",
                            footer: "© 2026 ITCSNEKA",
                            buttons: listMenu,
                        }
                    },
                    { quoted: fakeQuote }
                );
            } catch (error) {
                console.error("Error di case menu:", error);
                await sock.sendMessage(remoteJid, { text: "⚠️ Sistem gagal memuat menu." }, { quoted: fakeQuote });
            }
            break;
        }

        case ".ping": {
            await sock.sendMessage(
                remoteJid,
                {
                    text: "✦ *ITCSNEKA DASHBOARD* ✦\n\n🏓 Siap menerima instruksi",
                    footer: "© 2026 ITCSNEKA",
                    interactiveButtons: [
                        {
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                title: "Lihat Daftar Fitur",
                                sections: listMenu
                            })
                        }
                    ]
                },
                {
                    quoted: fakeQuote
                }
            );
            break;
        }

        case ".owner": {
            const settings = getSettings();
            const owners = Array.isArray(settings.ownerNumber)
                ? settings.ownerNumber
                : [settings.ownerNumber];
            const filteredOwners = owners.filter(Boolean);

            const ctaButtons = filteredOwners.map((num, index) => {
                const cleanNum = num.replace(/\D/g, "");
                return {
                    name: "cta_url",
                    buttonParamsJson: JSON.stringify({
                        display_text: `📞 Owner ${index + 1} (${num})`,
                        url: `https://wa.me/${cleanNum}`,
                        merchant_url: `https://wa.me/${cleanNum}`
                    })
                };
            });

            const selectButton = {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                    title: "Lihat Daftar Fitur",
                    sections: listMenu
                })
            };

            const buttons = [...ctaButtons, selectButton];
            await sock.sendMessage(
                remoteJid,
                {
                    text: "✦ *ITCSNEKA LEADER* ✦\n\nBerikut adalah nomor leader @itcsneka",
                    footer: "© 2026 ITCSNEKA",
                    interactiveButtons: buttons
                },
                {
                    quoted: fakeQuote
                }
            );
            break;
        }

        case '.jadwalrutin':{
            try {
                const jadwalPath = path.join(__dirname, "database", "jadwal.json");
                
                if (!fs.existsSync(jadwalPath)) {
                    await sock.sendMessage(remoteJid, { text: "❌ File jadwal.json tidak ditemukan di folder database!" }, { quoted: fakeQuote });
                    break;
                }

                const rawData = fs.readFileSync(jadwalPath, 'utf8');
                const richContent = JSON.parse(rawData);

                if (typeof sock.sendRichMessage !== "function") {
                    await sock.sendMessage(remoteJid, { text: "❌ Fitur sendRichMessage tidak tersedia di versi bot ini." }, { quoted: fakeQuote });
                    break;
                }

                await sock.sendRichMessage(remoteJid, richContent, m);

            } catch (error) {
                console.error("Error di case jadwalrutin:", error);
                await sock.sendMessage(remoteJid, { text: `❌ Gagal memuat jadwal:\n${error.message}` }, { quoted: fakeQuote });
            }
            break;
        }

        case '.jadwalpiket':{
            try {
                const jadwalPath = path.join(__dirname, "database", "jadwalPiket.json");
                
                if (!fs.existsSync(jadwalPath)) {
                    await sock.sendMessage(remoteJid, { text: "❌ File jadwalpiket.json tidak ditemukan di folder database!" }, { quoted: fakeQuote });
                    break;
                }

                const rawData = fs.readFileSync(jadwalPath, 'utf8');
                const richContent = JSON.parse(rawData);

                if (typeof sock.sendRichMessage !== "function") {
                    await sock.sendMessage(remoteJid, { text: "❌ Fitur sendRichMessage tidak tersedia di versi bot ini." }, { quoted: fakeQuote });
                    break;
                }

                await sock.sendRichMessage(remoteJid, richContent, m);

            } catch (error) {
                console.error("Error di case jadwalpiket:", error);
                await sock.sendMessage(remoteJid, { text: `❌ Gagal memuat jadwal:\n${error.message}` }, { quoted: fakeQuote });
            }
            break;
        }

        case '.kelompok':{
            try {
                const jadwalPath = path.join(__dirname, "database", "kelompok.json");
                
                if (!fs.existsSync(jadwalPath)) {
                    await sock.sendMessage(remoteJid, { text: "❌ File kelompok.json tidak ditemukan di folder database!" }, { quoted: fakeQuote });
                    break;
                }

                const rawData = fs.readFileSync(jadwalPath, 'utf8');
                const richContent = JSON.parse(rawData);

                if (typeof sock.sendRichMessage !== "function") {
                    await sock.sendMessage(remoteJid, { text: "❌ Fitur sendRichMessage tidak tersedia di versi bot ini." }, { quoted: fakeQuote });
                    break;
                }

                await sock.sendRichMessage(remoteJid, richContent, m);

            } catch (error) {
                console.error("Error di case kelompok:", error);
                await sock.sendMessage(remoteJid, { text: `❌ Gagal memuat jadwal:\n${error.message}` }, { quoted: fakeQuote });
            }
            break;
        }

case ".upswgc": {
    try {
        if (!remoteJid.endsWith("@g.us")) {
            await sock.sendMessage(
                remoteJid,
                {
                    text: "❌ Command ini hanya bisa digunakan di grup."
                },
                { quoted: fakeQuote }
            );
            break;
        }

        if (!m.quoted || !m.quoted.message) {
            await sock.sendMessage(
                remoteJid,
                {
                    text:
                        "❌ Reply pesan yang mau di-upload ke Group Status.\n\n" +
                        "Support:\n" +
                        "• Teks\n" +
                        "• Foto\n" +
                        "• Video\n" +
                        "• Audio\n" +
                        "• Dokumen\n" +
                        "• Sticker"
                },
                { quoted: fakeQuote }
            );
            break;
        }

        if (typeof sock.swgc !== "function") {
            await sock.sendMessage(
                remoteJid,
                {
                    text: "❌ Method swgc tidak tersedia."
                },
                { quoted: fakeQuote }
            );
            break;
        }

        const q = m.quoted;
        const quotedMsg = q.message;

        console.log("[UPSWGC] type:", q.mtype);

        /*
        |--------------------------------------------------------------------------
        | TEXT
        |--------------------------------------------------------------------------
        */

        if (
            q.mtype === "conversation" ||
            q.mtype === "extendedTextMessage"
        ) {
            const text =
                quotedMsg.conversation ||
                quotedMsg.extendedTextMessage?.text ||
                q.text ||
                "";

            if (!text.trim()) {
                throw new Error("Pesan teks kosong.");
            }

            await sock.swgc(remoteJid, {
                text
            });
        }

        /*
        |--------------------------------------------------------------------------
        | IMAGE
        |--------------------------------------------------------------------------
        */

        else if (q.mtype === "imageMessage") {
            await sock.swgc(remoteJid, {
                message: {
                    imageMessage: {
                        ...quotedMsg.imageMessage,
                        caption:
                            quotedMsg.imageMessage?.caption || ""
                    }
                }
            });
        }

        /*
        |--------------------------------------------------------------------------
        | VIDEO
        |--------------------------------------------------------------------------
        */

        else if (q.mtype === "videoMessage") {
            await sock.swgc(remoteJid, {
                message: {
                    videoMessage: {
                        ...quotedMsg.videoMessage,
                        caption:
                            quotedMsg.videoMessage?.caption || ""
                    }
                }
            });
        }

        /*
        |--------------------------------------------------------------------------
        | AUDIO
        |--------------------------------------------------------------------------
        */

        else if (q.mtype === "audioMessage") {
            await sock.swgc(remoteJid, {
                message: {
                    audioMessage: {
                        ...quotedMsg.audioMessage
                    }
                }
            });
        }

        /*
        |--------------------------------------------------------------------------
        | DOCUMENT
        |--------------------------------------------------------------------------
        */

        else if (q.mtype === "documentMessage") {
            await sock.swgc(remoteJid, {
                message: {
                    documentMessage: {
                        ...quotedMsg.documentMessage,
                        caption:
                            quotedMsg.documentMessage?.caption || ""
                    }
                }
            });
        }

        /*
        |--------------------------------------------------------------------------
        | STICKER
        |--------------------------------------------------------------------------
        */

        else if (q.mtype === "stickerMessage") {
            await sock.swgc(remoteJid, {
                message: {
                    stickerMessage: {
                        ...quotedMsg.stickerMessage
                    }
                }
            });
        }

        /*
        |--------------------------------------------------------------------------
        | CONTACT
        |--------------------------------------------------------------------------
        */

        else if (q.mtype === "contactMessage") {
            await sock.swgc(remoteJid, {
                message: {
                    contactMessage: {
                        ...quotedMsg.contactMessage
                    }
                }
            });
        }

        /*
        |--------------------------------------------------------------------------
        | LOCATION
        |--------------------------------------------------------------------------
        */

        else if (q.mtype === "locationMessage") {
            await sock.swgc(remoteJid, {
                message: {
                    locationMessage: {
                        ...quotedMsg.locationMessage
                    }
                }
            });
        }

        /*
        |--------------------------------------------------------------------------
        | LIVE LOCATION
        |--------------------------------------------------------------------------
        */

        else if (q.mtype === "liveLocationMessage") {
            await sock.swgc(remoteJid, {
                message: {
                    liveLocationMessage: {
                        ...quotedMsg.liveLocationMessage
                    }
                }
            });
        }

        /*
        |--------------------------------------------------------------------------
        | UNKNOWN
        |--------------------------------------------------------------------------
        */

        else {
            throw new Error(
                `Tipe pesan tidak didukung: ${q.mtype}`
            );
        }

        await sock.sendMessage(
            remoteJid,
            {
                text:
                    `✅ Berhasil upload ke Group Status.\n\n` +
                    `📦 Tipe: ${q.mtype}`
            },
            { quoted: fakeQuote }
        );

    } catch (error) {
        console.error("Error di case upswgc:", error);

        await sock.sendMessage(
            remoteJid,
            {
                text:
                    "❌ Gagal upload Group Status.\n\n" +
                    `📦 Error: ${error.message}`
            },
            { quoted: fakeQuote }
        );
    }

    break;
}

        default:
            break;
    }
}

const handleMessage = handler; 
const loadPlugins = async () => {};

export {
    handleMessage,
    handler,
    checkAccess,
    isOwner,
    isGroupAllowed,
    getSettings,
    getGroupAccess,
    loadPlugins
};
