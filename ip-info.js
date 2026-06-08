/*
 * OmniTools - IP Information & Advanced Diagnostics Toolbox
 * Fully offline calculator & privacy-focused client-side network diagnostics.
 * Optimized with GFW timeouts, global CDN maps, and concurrent IP racers.
 */

(function() {
    let ipMap = null;
    let ipMarker = null;
    let tileLayer = null;
    let isInitialized = false;

    // Translation helper
    function t(zh, en) {
        const isEn = document.body.classList.contains('lang-en');
        return isEn ? en : zh;
    }

    // DOM selection helper
    const $ = (id) => document.getElementById(id);

    // Custom fetch with timeout helper to prevent hanging on blocked nodes
    async function fetchWithTimeout(resource, options = {}) {
        const { timeout = 5000 } = options;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(resource, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(id);
            return response;
        } catch (err) {
            clearTimeout(id);
            throw err;
        }
    }

    // Initializer
    window.initIpInfo = async function() {
        if (isInitialized) {
            if (ipMap) {
                setTimeout(() => ipMap.invalidateSize(), 150);
            }
            return;
        }

        isInitialized = true;

        // Setup local client details
        setupClientEnvironment();

        // Bind event listeners
        bindEvents();

        // Run initial diagnostics
        runDualStackDetection();
        runIpLookup(''); // My IP Lookup
        runPingTests();
        runWebRTCTest();
        fetchDNSServerInfo();
    };

    function setupClientEnvironment() {
        $('ip-info-ua').textContent = navigator.userAgent;
        $('ip-info-lang').textContent = navigator.languages ? navigator.languages.join(', ') : navigator.language;
        
        // Update Local Time & Zone
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now = new Date();
        $('ip-info-timezone').textContent = `${now.toLocaleTimeString()} (${tz})`;
        
        // Update time regularly
        setInterval(() => {
            const current = new Date();
            $('ip-info-timezone').textContent = `${current.toLocaleTimeString()} (${tz})`;
        }, 1000);
    }

    function bindEvents() {
        // Copy buttons
        $('ip-btn-copy-v4').addEventListener('click', () => copyToClipboard('ip-v4-display', 'ip-btn-copy-v4'));
        $('ip-btn-copy-v6').addEventListener('click', () => copyToClipboard('ip-v6-display', 'ip-btn-copy-v6'));

        // IP Lookup click & enter key
        $('ip-btn-lookup').addEventListener('click', handleLookup);
        $('ip-lookup-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLookup();
        });

        // Refresh My IP button
        $('ip-btn-refresh').addEventListener('click', () => {
            $('ip-lookup-input').value = '';
            runIpLookup('');
            runDualStackDetection();
        });

        // Ping Retest button
        $('ip-btn-ping-test').addEventListener('click', runPingTests);

        // CIDR subnet calculator
        $('ip-btn-calc-subnet').addEventListener('click', runSubnetCalculation);
        $('ip-subnet-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runSubnetCalculation();
        });

        // Theme Toggle Listener to dynamically switch CartoDB Map styles
        const themeBtn = $('theme-toggle-btn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                setTimeout(() => {
                    if (ipMap && tileLayer) {
                        const isLight = document.body.classList.contains('light-theme');
                        const newUrl = isLight 
                            ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' 
                            : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
                        tileLayer.setUrl(newUrl);
                    }
                }, 100);
            });
        }
    }

    function copyToClipboard(displayId, btnId) {
        const text = $(displayId).textContent.trim();
        if (text === '检测中...' || text === '未检测到 / Not Detected' || !text) return;

        navigator.clipboard.writeText(text).then(() => {
            const btn = $(btnId);
            const origText = btn.textContent;
            btn.textContent = t('✅ 已复制 / Copied', '✅ Copied');
            setTimeout(() => {
                btn.textContent = origText;
            }, 1500);
        });
    }

    function handleLookup() {
        const input = $('ip-lookup-input').value.trim();
        if (!input) {
            alert(t('请输入有效的 IP 地址！', 'Please enter a valid IP address!'));
            return;
        }
        runIpLookup(input);
    }

    // Geolocation details resolver chain (with timeouts & fallback providers)
    async function runIpLookup(ip) {
        const loadingStr = t('正在加载...', 'Loading...');
        $('ip-info-country').textContent = loadingStr;
        $('ip-info-region').textContent = loadingStr;
        $('ip-info-city').textContent = loadingStr;
        $('ip-info-zip').textContent = loadingStr;
        $('ip-info-coordinates').textContent = loadingStr;
        $('ip-info-isp').textContent = loadingStr;
        $('ip-info-org').textContent = loadingStr;
        $('ip-info-asn').textContent = loadingStr;
        $('ip-info-range').textContent = loadingStr;

        const isHttps = window.location.protocol === 'https:';
        
        // Define Geolocation Providers in order of preference
        const endpoints = [];
        if (!isHttps) {
            // First choice on HTTP: ip-api.com (detailed stats)
            endpoints.push({
                url: `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query`,
                parse: (d) => ({
                    ip: d.query,
                    country: d.country,
                    countryCode: d.countryCode,
                    region: d.regionName,
                    city: d.city,
                    zip: d.zip,
                    lat: d.lat,
                    lon: d.lon,
                    isp: d.isp,
                    org: d.org,
                    asn: d.as,
                    proxy: d.proxy,
                    hosting: d.hosting,
                    mobile: d.mobile
                })
            });
        }
        
        // Fast global CDN-based HTTPS GeoIP provider: ip.sb
        endpoints.push({
            url: `https://api.ip.sb/geoip/${ip}`,
            parse: (d) => ({
                ip: d.ip,
                country: d.country,
                countryCode: d.country_code,
                region: d.region,
                city: d.city,
                zip: d.postal_code,
                lat: d.latitude,
                lon: d.longitude,
                isp: d.isp,
                org: d.organization,
                asn: `AS${d.asn}`,
                proxy: null, // to be populated by blackbox
                hosting: null,
                mobile: null
            })
        });

        // Backup HTTPS GeoIP provider: ipapi.co
        endpoints.push({
            url: `https://ipapi.co/${ip || 'json'}/json/`,
            parse: (d) => ({
                ip: d.ip,
                country: d.country_name,
                countryCode: d.country_code,
                region: d.region,
                city: d.city,
                zip: d.postal,
                lat: d.latitude,
                lon: d.longitude,
                isp: d.org,
                org: d.org,
                asn: d.asn,
                proxy: null,
                hosting: null,
                mobile: null
            })
        });

        let data = null;
        for (const provider of endpoints) {
            try {
                const res = await fetchWithTimeout(provider.url, { timeout: 4500 });
                if (!res.ok) continue;
                const raw = await res.json();
                if (raw.status === 'fail') continue;
                data = provider.parse(raw);
                break; // Succeeded! Stop trying fallbacks.
            } catch (err) {
                console.warn(`Geolocation provider ${provider.url} failed/timed out. trying next...`);
            }
        }

        if (!data) {
            // All providers failed
            $('ip-info-country').textContent = t('⚠️ 加载超时，请重试', '⚠️ Timeout, please retry');
            return;
        }

        const activeIp = ip || data.ip;

        // Update top displaying IP addresses
        if (!ip) {
            if (activeIp.includes(':')) {
                $('ip-v6-display').textContent = activeIp;
                $('ip-btn-copy-v6').disabled = false;
            } else {
                $('ip-v4-display').textContent = activeIp;
            }
        }

        // Fill subnet input if empty
        if (!$('ip-subnet-input').value) {
            $('ip-subnet-input').value = `${activeIp}/${activeIp.includes(':') ? '64' : '24'}`;
            runSubnetCalculation();
        }

        // Display results
        $('ip-info-country').textContent = (data.country || '-') + (data.countryCode ? ` (${data.countryCode})` : '');
        $('ip-info-region').textContent = data.region || '-';
        $('ip-info-city').textContent = data.city || '-';
        $('ip-info-zip').textContent = data.zip || '-';
        $('ip-info-coordinates').textContent = (isNaN(data.lat) || isNaN(data.lon)) ? '-' : `${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}`;
        $('ip-info-isp').textContent = data.isp || '-';
        $('ip-info-org').textContent = data.org || '-';
        $('ip-info-asn').textContent = data.asn || '-';
        $('ip-info-range').textContent = activeIp;

        // Load Whois RDAP files
        fetchWhoisData(activeIp);

        // Load map marker
        if (!isNaN(data.lat) && !isNaN(data.lon)) {
            initMap(data.lat, data.lon);
        }

        // Security check
        let isProxy = data.proxy || false;
        let isHosting = data.hosting || false;
        let isMobile = data.mobile || false;
        let blackboxRep = 'N';

        // Query blackbox reputation (with 4s timeout)
        try {
            const bbRes = await fetchWithTimeout(`https://blackbox.ipinfo.app/lookup/${activeIp}`, { timeout: 4000 });
            if (bbRes.ok) {
                const txt = await bbRes.text();
                blackboxRep = txt.trim();
            }
        } catch (err) {
            console.warn('Blackbox reputation lookup failed or timed out', err);
        }

        if (blackboxRep === 'Y') {
            isProxy = true;
        }

        // Calculate cleanliness score
        let purity = 100;
        if (isProxy) purity -= 60;
        if (isHosting) purity -= 40;

        const lowerOrg = ((data.isp || '') + ' ' + (data.org || '')).toLowerCase();
        const cloudKeywords = ['amazon', 'google', 'microsoft', 'digitalocean', 'hetzner', 'linode', 'ovh', 'choopa', 'colocrossing', 'datacamp', 'm247', 'cloudflare', 'leaseweb', 'fastly', 'akamai', 'alibaba', 'tencent', 'azure', 'aws', 'vultr'];
        const isCloud = cloudKeywords.some(kw => lowerOrg.includes(kw));
        if (isCloud && !isHosting) {
            isHosting = true;
            purity -= 40;
        }
        purity = Math.max(5, purity);

        // Render purity card details
        const badge = $('ip-purity-score-badge');
        badge.textContent = `${purity}%`;
        badge.className = 'preview-badge';
        if (purity >= 80) {
            badge.classList.add('badge-safe');
        } else if (purity >= 50) {
            badge.classList.add('badge-warning');
        } else {
            badge.classList.add('badge-danger');
        }

        $('ip-purity-proxy').innerHTML = isProxy ? '<span style="color: #EF4444; font-weight: 600;">⚠️ Yes (Proxy/VPN/Tor)</span>' : '<span style="color: #10B981; font-weight: 600;">✅ No</span>';
        $('ip-purity-hosting').innerHTML = isHosting ? '<span style="color: #F59E0B; font-weight: 600;">⚠️ Yes (Datacenter/Cloud)</span>' : '<span style="color: #10B981; font-weight: 600;">✅ No</span>';
        $('ip-purity-mobile').textContent = isMobile ? t('是 / Yes (Mobile Cellular)', 'Yes (Mobile Cellular)') : t('否 / No', 'No');
        $('ip-purity-blackbox').textContent = blackboxRep === 'Y' ? t('⚠️ 匿名节点 / Anonymous Node', '⚠️ Anonymous Node') : t('✅ 正常信誉 / Clean Reputation', '✅ Clean Reputation');
    }

    // Leaflet map setup using native dark/light CartoDB layers (High speed Fastly CDN)
    function initMap(lat, lon) {
        try {
            if (!window.L) return;
            
            const isLight = document.body.classList.contains('light-theme');
            const tileUrl = isLight 
                ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' 
                : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

            if (ipMap) {
                ipMap.setView([lat, lon], 12);
                if (ipMarker) {
                    ipMarker.setLatLng([lat, lon]);
                } else {
                    ipMarker = L.marker([lat, lon]).addTo(ipMap);
                }
                if (tileLayer) {
                    tileLayer.setUrl(tileUrl);
                }
                ipMap.invalidateSize();
            } else {
                ipMap = L.map('ip-map').setView([lat, lon], 12);
                tileLayer = L.tileLayer(tileUrl, {
                    attribution: '&copy; <a href="https://carto.com/">CartoDB</a>',
                    subdomains: 'abcd',
                    maxZoom: 20
                }).addTo(ipMap);
                ipMarker = L.marker([lat, lon]).addTo(ipMap);
                
                setTimeout(() => {
                    ipMap.invalidateSize();
                }, 300);
            }
        } catch (err) {
            console.warn('Leaflet initialization error:', err);
        }
    }

    // Parallel Racer public IP detector (Resolves instantly by racing multiple sources)
    async function runDualStackDetection() {
        // --- IPv4 Racer ---
        const v4Controllers = [new AbortController(), new AbortController(), new AbortController()];
        const v4Promises = [
            fetch('https://api4.ipify.org?format=json', { signal: v4Controllers[0].signal }).then(r => r.json()).then(d => d.ip),
            fetch('https://api.ip.sb/ip', { signal: v4Controllers[1].signal }).then(r => r.text()).then(t => t.trim()),
            fetch('https://ipapi.co/ip/', { signal: v4Controllers[2].signal }).then(r => r.text()).then(t => t.trim())
        ];

        Promise.any(v4Promises).then(firstIp => {
            v4Controllers.forEach(c => c.abort()); // cancel others
            if (!firstIp.includes(':')) {
                $('ip-v4-display').textContent = firstIp;
            }
        }).catch(() => {
            // All fast racers failed, do direct fallback
            fetchWithTimeout('https://api4.ipify.org?format=json', { timeout: 5000 })
                .then(r => r.json())
                .then(d => $('ip-v4-display').textContent = d.ip)
                .catch(() => $('ip-v4-display').textContent = t('未检测到 / Not Detected', 'Not Detected'));
        });

        // --- IPv6 Racer ---
        const v6Controllers = [new AbortController(), new AbortController()];
        const v6Promises = [
            fetch('https://api6.ipify.org?format=json', { signal: v6Controllers[0].signal }).then(r => r.json()).then(d => d.ip),
            fetch('https://api6.ip.sb/ip', { signal: v6Controllers[1].signal }).then(r => r.text()).then(t => t.trim())
        ];

        Promise.any(v6Promises).then(firstIp => {
            v6Controllers.forEach(c => c.abort()); // cancel others
            if (firstIp.includes(':')) {
                $('ip-v6-display').textContent = firstIp;
                $('ip-btn-copy-v6').disabled = false;
            }
        }).catch(() => {
            fetchWithTimeout('https://api6.ipify.org?format=json', { timeout: 5000 })
                .then(r => r.json())
                .then(d => {
                    $('ip-v6-display').textContent = d.ip;
                    $('ip-btn-copy-v6').disabled = false;
                })
                .catch(() => {
                    $('ip-v6-display').textContent = t('未检测到 / Not Detected', 'Not Detected');
                    $('ip-btn-copy-v6').disabled = true;
                });
        });
    }

    // Ping Round-Trip-Time (RTT) diagnostics
    async function pingNode(url) {
        const start = performance.now();
        try {
            const cb = `?cb=${Math.random()}`;
            // Measure RTT via fetch with short timeout
            await fetchWithTimeout(url + cb, { mode: 'no-cors', cache: 'no-cache', timeout: 2000 });
            return Math.round(performance.now() - start);
        } catch (e) {
            // If fetch aborted or failed, try image loading fallback
            return new Promise((resolve) => {
                const img = new Image();
                const startImg = performance.now();
                img.onload = () => resolve(Math.round(performance.now() - startImg));
                img.onerror = () => resolve(Math.round(performance.now() - startImg));
                img.src = url + `?cb=${Math.random()}`;
                setTimeout(() => resolve(null), 2000); // 2s timeout
            });
        }
    }

    async function runPingTests() {
        const nodes = [
            { id: 'cf', url: 'https://1.1.1.1/cdn-cgi/trace' },
            { id: 'google', url: 'https://accounts.google.com/favicon.ico' },
            { id: 'ali', url: 'https://g.alicdn.com/favicon.ico' },
            { id: 'baidu', url: 'https://www.baidu.com/favicon.ico' }
        ];

        for (const node of nodes) {
            const display = $(`ip-ping-${node.id}`);
            const bar = $(`ip-ping-${node.id}-bar`);
            display.textContent = t('测试中...', 'Testing...');
            bar.style.width = '0%';
            bar.style.background = '#10B981';

            const rtt = await pingNode(node.url);
            if (rtt === null || rtt > 2000) {
                display.textContent = t('超时 / Timeout', 'Timeout');
                bar.style.width = '100%';
                bar.style.background = '#EF4444';
            } else {
                display.textContent = `${rtt} ms`;
                const pct = Math.min(100, Math.round((rtt / 400) * 100));
                bar.style.width = `${pct}%`;
                if (rtt < 120) {
                    bar.style.background = '#10B981';
                } else if (rtt < 280) {
                    bar.style.background = '#F59E0B';
                } else {
                    bar.style.background = '#EF4444';
                }
            }
        }
    }

    // WebRTC Local IP detection
    function runWebRTCTest() {
        const display = $('ip-info-webrtc');
        display.textContent = t('正在获取...', 'Gathering...');

        const RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
        if (!RTCPeerConnection) {
            display.textContent = t('浏览器不支持 WebRTC / Not Supported', 'Not Supported');
            return;
        }

        const ips = [];
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {});
        
        pc.onicecandidate = (ice) => {
            if (!ice || !ice.candidate || !ice.candidate.candidate) {
                finalizeWebRTC();
                return;
            }
            const parts = ice.candidate.candidate.split(' ');
            const ip = parts[4];
            if (ip && !ips.includes(ip)) {
                ips.push(ip);
            }
        };

        // Fallback timer
        const timer = setTimeout(finalizeWebRTC, 1200);

        function finalizeWebRTC() {
            clearTimeout(timer);
            pc.onicecandidate = null;
            if (ips.length === 0) {
                display.textContent = t('无泄露 / No Leaks', 'No Leaks');
            } else {
                const realIps = ips.filter(ip => !ip.endsWith('.local'));
                if (realIps.length === 0 && ips.some(ip => ip.endsWith('.local'))) {
                    display.textContent = t('🛡️ 已被 mDNS 混淆保护 (无泄露)', '🛡️ Protected by mDNS (No Leaks)');
                } else if (realIps.length > 0) {
                    display.textContent = realIps.join(', ');
                } else {
                    display.textContent = t('无泄露 / No Leaks', 'No Leaks');
                }
            }
        }
    }

    // DNS server info via EDNS
    async function fetchDNSServerInfo() {
        const dnsDisplay = $('ip-info-dns');
        dnsDisplay.textContent = t('正在检测...', 'Testing...');
        try {
            // First choice: edns.ip-api.com (HTTP only)
            const res = await fetchWithTimeout('http://edns.ip-api.com/json', { timeout: 3500 });
            const data = await res.json();
            if (data && data.dns) {
                dnsDisplay.textContent = `${data.dns.ip} (${data.dns.geo || ''})`;
            } else {
                dnsDisplay.textContent = t('未检测到 DNS 信息', 'No DNS info detected');
            }
        } catch (err) {
            // Fallback for HTTPS (mixed content blocks HTTP request to edns)
            try {
                const res = await fetchWithTimeout('https://1.1.1.1/cdn-cgi/trace', { timeout: 3500 });
                const text = await res.text();
                const lines = text.split('\n');
                const cfData = {};
                lines.forEach(l => {
                    const parts = l.split('=');
                    if (parts.length === 2) cfData[parts[0]] = parts[1];
                });
                if (cfData.ip) {
                    dnsDisplay.textContent = `Cloudflare DNS (via ${cfData.colo || 'Anycast'})`;
                } else {
                    dnsDisplay.textContent = t('受安全协议限制 (HTTPS 混合内容)', 'HTTPS Mixed Content Restrict');
                }
            } catch (e) {
                dnsDisplay.textContent = t('无法获取 DNS', 'Unable to retrieve DNS');
            }
        }
    }

    // Whois RDAP loader (with fast timeouts per registry query)
    async function fetchWhoisData(ip) {
        const source = $('ip-whois-source');
        const handle = $('ip-whois-handle');
        const date = $('ip-whois-date');
        const abuse = $('ip-whois-abuse');

        const loadingStr = t('获取中...', 'Loading...');
        source.textContent = loadingStr;
        handle.textContent = loadingStr;
        date.textContent = loadingStr;
        abuse.textContent = loadingStr;

        const endpoints = [
            `https://rdap.db.ripe.net/ip/${ip}`,
            `https://rdap.apnic.net/ip/${ip}`
        ];

        for (const url of endpoints) {
            try {
                const res = await fetchWithTimeout(url, { timeout: 4000 });
                if (!res.ok) continue;
                const data = await res.json();

                source.textContent = data.port43 || data.objectClassName || 'RDAP';
                handle.textContent = data.handle || data.name || '-';

                let regDate = '-';
                if (data.events) {
                    const regEvent = data.events.find(e => e.eventAction === 'registration');
                    if (regEvent) regDate = new Date(regEvent.eventDate).toLocaleDateString();
                }
                date.textContent = regDate;

                let abuseEmail = '-';
                if (data.entities) {
                    function findAbuse(entities) {
                        for (const ent of entities) {
                            if (ent.vcardArray) {
                                const card = ent.vcardArray[1];
                                const emailEntry = card.find(item => item[0] === 'email');
                                if (emailEntry) return emailEntry[3];
                            }
                            if (ent.entities) {
                                const email = findAbuse(ent.entities);
                                if (email) return email;
                            }
                        }
                        return null;
                    }
                    abuseEmail = findAbuse(data.entities) || '-';
                }
                abuse.textContent = abuseEmail;
                return; // Stop on first success
            } catch (err) {
                console.warn(`RDAP failed or timed out on ${url}:`, err);
            }
        }

        source.textContent = t('暂不支持或查询超时', 'Registry Query Timeout');
        handle.textContent = '-';
        date.textContent = '-';
        abuse.textContent = '-';
    }

    // Subnet calculation
    function runSubnetCalculation() {
        const input = $('ip-subnet-input').value.trim();
        if (!input) return;

        const result = calculateSubnet(input);
        if (!result) {
            alert(t('请输入正确的 CIDR 格式，例如: 192.168.1.1/24', 'Please enter valid CIDR notation, e.g. 192.168.1.1/24'));
            return;
        }

        $('ip-subnet-mask').textContent = result.mask;
        $('ip-subnet-net').textContent = result.network;
        $('ip-subnet-broadcast').textContent = result.broadcast;
        $('ip-subnet-range').textContent = result.range;
        $('ip-subnet-hosts').textContent = result.hosts;
    }

    function calculateSubnet(cidrStr) {
        const parts = cidrStr.split('/');
        if (parts.length !== 2) return null;
        const ip = parts[0];
        const bitmask = parseInt(parts[1], 10);
        if (isNaN(bitmask) || bitmask < 0 || bitmask > 32) return null;

        const ipParts = ip.split('.').map(Number);
        if (ipParts.length !== 4 || ipParts.some(isNaN) || ipParts.some(p => p < 0 || p > 255)) return null;

        const ipInt = (ipParts[0] << 24) >>> 0 | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
        const maskInt = bitmask === 0 ? 0 : (~0 << (32 - bitmask)) >>> 0;
        const netInt = (ipInt & maskInt) >>> 0;
        const broadInt = (netInt | ~maskInt) >>> 0;

        const intToIp = (num) => [
            (num >>> 24) & 255,
            (num >>> 16) & 255,
            (num >>> 8) & 255,
            num & 255
        ].join('.');

        const maskStr = intToIp(maskInt);
        const netStr = intToIp(netInt);
        const broadStr = intToIp(broadInt);

        let rangeStr = '-';
        let totalHosts = 0;

        if (bitmask === 32) {
            rangeStr = ip;
            totalHosts = 1;
        } else if (bitmask === 31) {
            rangeStr = `${intToIp(netInt)} - ${intToIp(broadInt)}`;
            totalHosts = 2;
        } else {
            rangeStr = `${intToIp(netInt + 1)} - ${intToIp(broadInt - 1)}`;
            totalHosts = broadInt - netInt - 1;
        }

        return {
            mask: maskStr,
            network: netStr,
            broadcast: broadStr,
            range: rangeStr,
            hosts: totalHosts.toLocaleString()
        };
    }

})();
