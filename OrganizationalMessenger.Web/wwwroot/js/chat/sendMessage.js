// ========================================
// Universal Message Sender v3.0 - Hybrid
// ========================================

import { currentChat, replyingToMessage, setReplyingToMessage } from './variables.js';
import { getCsrfToken, scrollToBottom } from './utils.js';

/**
 * ✅ ارسال پیام متنی - فقط SignalR
 */
export async function sendTextMessage() {
    const input = document.getElementById('messageInput');
    const text = input?.value.trim();

    if (!text || !currentChat || !window.connection) return;

    if (window.connection.state !== signalR.HubConnectionState.Connected) {
        alert('اتصال برقرار نیست');
        return;
    }

    try {
        if (currentChat.type === 'private') {
            await window.connection.invoke(
                "SendPrivateMessage",
                currentChat.id,
                text,
                replyingToMessage?.id || null
            );
        } else if (currentChat.type === 'group') {
            await window.connection.invoke(
                "SendGroupMessage",
                currentChat.id,
                text,
                replyingToMessage?.id || null
            );
        } else if (currentChat.type === 'channel') {
            await window.connection.invoke(
                "SendChannelMessage",
                currentChat.id,
                text,
                replyingToMessage?.id || null
            );
        }

        input.value = '';
        input.style.height = 'auto';
        setReplyingToMessage(null);
        document.getElementById('replyPreview')?.remove();
        scrollToBottom();
    } catch (error) {
        console.error('❌ Send error:', error);
        alert('خطا در ارسال');
    }
}

/**
 * ✅ ارسال فایل - API + SignalR
 */
async function sendFileMessage(file, caption = '') {
    if (!currentChat || !window.connection) {
        console.error('❌ currentChat یا connection موجود نیست');
        return;
    }

    if (window.connection.state !== signalR.HubConnectionState.Connected) {
        console.error('❌ SignalR is not connected!');
        alert('اتصال برقرار نیست');
        return;
    }

    const messageText = caption || `📎 ${file.originalFileName}`;

    try {
        console.log('📤 Sending file message via SignalR...');

        if (currentChat.type === 'private') {
            await window.connection.invoke(
                "SendPrivateMessageWithFile",
                currentChat.id,
                messageText,
                file.id,
                null // duration
            );
        } else if (currentChat.type === 'group') {
            await window.connection.invoke(
                "SendGroupMessageWithFile",
                currentChat.id,
                messageText,
                file.id,
                null
            );
        } else if (currentChat.type === 'channel') {
            await window.connection.invoke(
                "SendChannelMessageWithFile",
                currentChat.id,
                messageText,
                file.id,
                null
            );
        }

        console.log('✅ File message sent via SignalR');
        scrollToBottom();
    } catch (error) {
        console.error('❌ Send file message error:', error);
        alert('خطا در ارسال فایل');
    }
}
function getFileType(fileType) {
    const map = { 'Image': 1, 'Video': 2, 'Audio': 3, 'Document': 5 };
    return map[fileType] || 5;
}

window.sendTextMessage = sendTextMessage;
window.sendFileMessage = sendFileMessage;

console.log('✅ sendMessage.js v3.0 loaded (Hybrid)');