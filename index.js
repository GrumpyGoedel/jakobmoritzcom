const express = require("express");
const path = require("path");
const fs = require("fs");
const geoip = require('geoip-lite');

const app = express();
const PORT = 3001;

let visitors = []; // Simple in-memory storage

app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
    // Get the IP from Nginx header
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // geoip-lite doesn't like IPv6 loopback (::1) or local IPs
    const geo = geoip.lookup(ip);

    if (geo) {
        visitors.push({
            ip: ip,
            city: geo.city,
            country: geo.country,
            region: geo.region,
            ll: geo.ll, // Latitude and Longitude
            time: new Date().toLocaleString()
        });
    }
    
    // Keep only the last 50 visitors to save memory
    if (visitors.length > 50) visitors.shift();
    
    next();
});

app.get('/stats', (req, res) => {
    let html = '<h1>Recent Visitors</h1><ul>';
    visitors.forEach(v => {
        html += `<li><strong>${v.time}</strong>: ${v.city}, ${v.country} (IP: ${v.ip})</li>`;
    });
    html += '</ul>';
    res.send(html);
});

app.listen(PORT, () => {
  console.log(`Running at http://localhost:${PORT}`);
});