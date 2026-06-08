/*
 * OmniTools - IP Information & Advanced Diagnostics Toolbox
 * Fully offline calculator & privacy-focused client-side network diagnostics.
 */

(function() {
    let ipMap = null;
    let ipMarker = null;
    let isInitialized = false;

    // Translation helper
    function t(zh, en) {
        const isEn = document.body.classList.contains('lang-en');
        return isEn ? en : zh;
    }

    // DOM selection helper
    const $ = (id) => document.getElementById(id);

    // Initializer
    window.initIpInfo = async function() {
        // If already initialized, just invalidate size of map in case layout shifted
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

    // IP Geolocation & security info lookup
    async function runIpLookup(ip) {
        // Loading states
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
        // Double data source URL builder
        let url = '';
        if (isHttps) {
            url = `https://ipapi.co/${ip || 'json'}/json/`;
        } else {
            url = `http://ip-api.com/json/${ip || ''}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query`;
        }

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Primary GeoIP lookup failed');
            const data = await res.json();
            
            const activeIp = ip || data.query || data.ip;

            // If it was empty query, update top summary info cards
            if (!ip) {
                if (activeIp.includes(':')) {
                    $('ip-v6-display').textContent = activeIp;
                    $('ip-btn-copy-v6').disabled = false;
                } else {
                    $('ip-v4-display').textContent = activeIp;
                }
            }

            // Fill subnet calculator if blank
            if (!$('ip-subnet-input').value) {
                $('ip-subnet-input').value = `${activeIp}/${activeIp.includes(':') ? '64' : '24'}`;
                runSubnetCalculation();
            }

            // Bind values
            const country = data.country || data.country_name || '-';
            const countryCode = data.countryCode || data.country_code || '';
            const region = data.regionName || data.region || '-';
            const city = data.city || '-';
            const zip = data.zip || data.postal || '-';
            const lat = parseFloat(data.lat || data.latitude);
            const lon = parseFloat(data.lon || data.longitude);
            const timezone = data.timezone || '-';
            const isp = data.isp || data.org || '-';
            const org = data.org || data.asn || '-';
            const asn = data.as || data.asn || '-';

            $('ip-info-country').textContent = country + (countryCode ? ` (${countryCode})` : '');
            $('ip-info-region').textContent = region;
            $('ip-info-city').textContent = city;
            $('ip-info-zip').textContent = zip;
            $('ip-info-coordinates').textContent = (isNaN(lat) || isNaN(lon)) ? '-' : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
            $('ip-info-isp').textContent = isp;
            $('ip-info-org').textContent = org;
            $('ip-info-asn').textContent = asn;
            $('ip-info-range').textContent = activeIp;

            // Load Whois registration files
            fetchWhoisData(activeIp);

            // Leaflet Map position
            if (!isNaN(lat) && !isNaN(lon)) {
                initMap(lat, lon);
            }

            // IP Purity Security Card
            let isProxy = data.proxy || false;
            let isHosting = data.hosting || false;
            let isMobile = data.mobile || false;
            let blackboxRep = 'N';

            // Safe fetch anonymous blackbox reputation list
            try {
                const bbRes = await fetch(`https://blackbox.ipinfo.app/lookup/${activeIp}`);
                if (bbRes.ok) {
                    const txt = await bbRes.text();
                    blackboxRep = txt.trim(); // Y or N
                }
            } catch (err) {
                console.warn('Blackbox lookup failed', err);
            }

            if (blackboxRep === 'Y') {
                isProxy = true;
            }

            // Calculate purity
            let purity = 100;
            if (isProxy) purity -= 60;
            if (isHosting) purity -= 40;

            const lowerOrg = (isp + ' ' + org).toLowerCase();
            const cloudKeywords = ['amazon', 'google', 'microsoft', 'digitalocean', 'hetzner', 'linode', 'ovh', 'choopa', 'colocrossing', 'datacamp', 'm247', 'cloudflare', 'leaseweb', 'fastly', 'akamai', 'alibaba', 'tencent', 'azure', 'aws', 'vultr'];
            const isCloud = cloudKeywords.some(kw => lowerOrg.includes(kw));
            if (isCloud && !isHosting) {
                isHosting = true;
                purity -= 40;
            }
            purity = Math.max(5, purity);

            // Update badge UI classes
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

        } catch (e) {
            console.error('Primary GeoIP Lookup error', e);
            // Fallback strategy: If ipapi.co fails or rate limits, query api.ip.sb
            try {
                const res = await fetch(`https://api.ip.sb/geoip/${ip}`);
                const data = await res.json();
                const activeIp = ip || data.ip;

                $('ip-info-country').textContent = data.country || '-';
                $('ip-info-region').textContent = data.region || '-';
                $('ip-info-city').textContent = data.city || '-';
                $('ip-info-zip').textContent = data.postal || '-';
                $('ip-info-coordinates').textContent = `${data.latitude || 0}, ${data.longitude || 0}`;
                $('ip-info-isp').textContent = data.isp || '-';
                $('ip-info-org').textContent = data.asn_organization || '-';
                $('ip-info-asn').textContent = `AS${data.asn || ''}`;
                $('ip-info-range').textContent = activeIp;

                fetchWhoisData(activeIp);
                if (data.latitude && data.longitude) {
                    initMap(data.latitude, data.longitude);
                }
            } catch (fallbackErr) {
                console.error('IP fallback query failed', fallbackErr);
                $('ip-info-country').textContent = t('检测失败，请重试', 'Lookup failed, retry');
            }
        }
    }

    // Leaflet map setup
    function initMap(lat, lon) {
        try {
            if (!window.L) {
                console.error('Leaflet L variable not found');
                return;
            }
            if (ipMap) {
                ipMap.setView([lat, lon], 12);
                if (ipMarker) {
                    ipMarker.setLatLng([lat, lon]);
                } else {
                    ipMarker = L.marker([lat, lon]).addTo(ipMap);
                }
                ipMap.invalidateSize();
            } else {
                ipMap = L.map('ip-map').setView([lat, lon], 12);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap contributors'
                }).addTo(ipMap);
                ipMarker = L.marker([lat, lon]).addTo(ipMap);
                
                setTimeout(() => {
                    ipMap.invalidateSize();
                }, 300);
            }
        } catch (err) {
            console.warn('Map initialization crashed:', err);
        }
    }

    // Public IPv4 & IPv6 detection
    async function runDualStackDetection() {
        // v4
        try {
            const res = await fetch('https://api4.ipify.org?format=json');
            const data = await res.json();
            $('ip-v4-display').textContent = data.ip;
        } catch (e) {
            $('ip-v4-display').textContent = t('未检测到 / Not Detected', 'Not Detected');
        }
        // v6
        try {
            const res = await fetch('https://api6.ipify.org?format=json');
            const data = await res.json();
            $('ip-v6-display').textContent = data.ip;
            $('ip-btn-copy-v6').disabled = false;
        } catch (e) {
            $('ip-v6-display').textContent = t('未检测到 / Not Detected', 'Not Detected');
            $('ip-btn-copy-v6').disabled = true;
        }
    }

    // Ping diagnostic tester
    async function pingNode(url) {
        const start = performance.now();
        try {
            const cb = `?cb=${Math.random()}`;
            await fetch(url + cb, { mode: 'no-cors', cache: 'no-cache' });
            return Math.round(performance.now() - start);
        } catch (e) {
            return new Promise((resolve) => {
                const img = new Image();
                const startImg = performance.now();
                img.onload = () => resolve(Math.round(performance.now() - startImg));
                img.onerror = () => resolve(Math.round(performance.now() - startImg));
                img.src = url + `?cb=${Math.random()}`;
                setTimeout(() => resolve(null), 2000);
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
                // Filter out mDNS local addresses and check if IP is residential local
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
            // First choice: edns.ip-api.com (works in HTTP)
            const res = await fetch('http://edns.ip-api.com/json');
            const data = await res.json();
            if (data && data.dns) {
                dnsDisplay.textContent = `${data.dns.ip} (${data.dns.geo || ''})`;
            } else {
                dnsDisplay.textContent = t('未检测到 DNS 信息', 'No DNS info detected');
            }
        } catch (err) {
            // Fallback for HTTPS (mixed content blocks HTTP request to edns)
            try {
                const res = await fetch('https://1.1.1.1/cdn-cgi/trace');
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

    // Whois RDAP loader
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

        // Try RIPE proxy/bootstrap first as it has global redirects enabled
        const endpoints = [
            `https://rdap.db.ripe.net/ip/${ip}`,
            `https://rdap.apnic.net/ip/${ip}`
        ];

        for (const url of endpoints) {
            try {
                const res = await fetch(url);
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
                console.warn(`RDAP failed on ${url}:`, err);
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
