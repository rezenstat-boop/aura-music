// AURA MUSIC — user panel configuration
// NO SECRETS belong in this file. It only contains public values.
// Change API_BASE_URL to your deployed Worker URL, e.g.
//   const API_BASE_URL = 'https://aura-music-api.<your-subdomain>.workers.dev';
const API_BASE_URL = 'http://localhost:8787'; // wrangler dev default
const APP_NAME = 'AURA MUSIC';

// Media URLs are built from the same worker (audio/images stream through it).
function audioUrl(songId) { return `${API_BASE_URL}/media/audio/${songId}`; }
function coverUrl(type, id) { return `${API_BASE_URL}/media/cover/${type}/${id}`; }
function avatarUrl(key) { return `${API_BASE_URL}/media/avatar/${key}`; }
