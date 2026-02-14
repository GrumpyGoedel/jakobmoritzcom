const express = require("express");
const path = require("path");
const fs = require("fs");
const geoip = require('geoip-lite');
const axios = require('axios');
const { Tail } = require('tail');

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

// In-memory cache for IP geolocation
const ipCache = new Map();

// Parse nginx log line (combined format)
function parseNginxLog(line) {
    // Nginx combined log format regex
    const regex = /^(\S+) - (\S+) \[([^\]]+)\] "(\S+) (\S+) (\S+)" (\d+) (\d+) "([^"]*)" "([^"]*)"/;
    const match = line.match(regex);

    if (!match) return null;

    return {
        ip: match[1],
        remoteUser: match[2],
        timestamp: match[3],
        method: match[4],
        url: match[5],
        protocol: match[6],
        status: parseInt(match[7]),
        bodyBytes: parseInt(match[8]),
        referer: match[9],
        userAgent: match[10]
    };
}

// Batch fetch geolocation data from ip-api.com
async function fetchGeolocation(ips) {
    const uncachedIps = ips.filter(ip => !ipCache.has(ip));

    if (uncachedIps.length === 0) {
        return;
    }

    try {
        // ip-api.com batch endpoint (max 100 IPs per request)
        const batchSize = 100;
        for (let i = 0; i < uncachedIps.length; i += batchSize) {
            const batch = uncachedIps.slice(i, i + batchSize);

            const response = await axios.post('http://ip-api.com/batch', batch.map(ip => ({
                query: ip,
                fields: 'status,country,countryCode,region,regionName,city,lat,lon,query'
            })), {
                timeout: 5000
            });

            // Cache the results
            response.data.forEach(result => {
                if (result.status === 'success') {
                    ipCache.set(result.query, {
                        city: result.city || 'Unknown',
                        country: result.country || 'Unknown',
                        countryCode: result.countryCode || '',
                        region: result.regionName || '',
                        lat: result.lat,
                        lon: result.lon
                    });
                } else {
                    // Cache failed lookups too to avoid repeated API calls
                    ipCache.set(result.query, {
                        city: 'Unknown',
                        country: 'Unknown',
                        countryCode: '',
                        region: ''
                    });
                }
            });
        }
    } catch (error) {
        console.error('Geolocation API error:', error.message);
    }
}

// Analytics route
app.get('/analytics', async (req, res) => {
    const logPath = '/var/log/nginx/access.log';
    const linesToRead = parseInt(req.query.lines) || 200;

    try {
        // Check if log file exists and is readable
        if (!fs.existsSync(logPath)) {
            return res.status(404).json({
                error: 'Log file not found',
                message: 'Nginx access log not found at ' + logPath
            });
        }

        // Read last N lines from log file
        const fileContent = fs.readFileSync(logPath, 'utf8');
        const lines = fileContent.trim().split('\n');
        const lastLines = lines.slice(-linesToRead);

        // Parse log entries
        const entries = [];
        const uniqueIps = new Set();

        for (const line of lastLines) {
            const parsed = parseNginxLog(line);
            if (parsed) {
                entries.push(parsed);
                uniqueIps.add(parsed.ip);
            }
        }

        // Fetch geolocation for unique IPs
        await fetchGeolocation(Array.from(uniqueIps));

        // Enrich entries with geolocation data
        const enrichedEntries = entries.map(entry => ({
            ...entry,
            location: ipCache.get(entry.ip) || { city: 'Unknown', country: 'Unknown' }
        }));

        res.json({
            success: true,
            count: enrichedEntries.length,
            entries: enrichedEntries.reverse() // Most recent first
        });

    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({
            error: 'Failed to read log file',
            message: error.message,
            hint: 'You may need to adjust file permissions or run with appropriate privileges'
        });
    }
});

app.listen(PORT, () => {
  console.log(`Running at http://localhost:${PORT}`);
});