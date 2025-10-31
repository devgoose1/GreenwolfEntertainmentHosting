require('dotenv').config();
const axios = require('axios');

const ITCH_API_KEY = process.env.ITCH_API_KEY;
const UPLOAD_ID = '15391748'; // replace with one of your known upload IDs

(async () => {
    try {
        console.log('Testing itch.io download URL for upload ID:', UPLOAD_ID);
        const response = await axios.get(`https://itch.io/api/1/${ITCH_API_KEY}/upload/${UPLOAD_ID}/download`);
        console.log('Raw response from itch.io:', response.data);

        if (response.data.url) {
            console.log('Download URL is available:', response.data.url);
        } else {
            console.log('No URL returned');
        }
    } catch (err) {
        console.error('Failed to get download link:', err.response?.data || err.message);
    }
})();
