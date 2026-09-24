// AURA MUSIC — admin panel configuration (public values only, NO secrets)
const API_BASE_URL = 'https://aura-music-admin-panel.subhajitghosh20001.workers.dev'; // wrangler dev default — change to your Worker URL in production
const APP_NAME = 'AURA MUSIC';

function mediaUrl(key) { return `${API_BASE_URL}/media/raw/${key}`; }
function coverPreviewUrl(type, id) { return `${API_BASE_URL}/media/cover/${type}/${id}`; }
