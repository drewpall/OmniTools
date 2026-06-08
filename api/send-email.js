const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
    // Add headers to support cross-origin isolation or CORS if called during local tests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    const { smtpHost, smtpPort, secure, user, pass, to, subject, body, contentType } = req.body;

    if (!smtpHost || !smtpPort || !user || !pass || !to || !subject || !body) {
        return res.status(400).json({ success: false, error: 'Missing required email parameters.' });
    }

    try {
        const isSecure = secure === true || parseInt(smtpPort, 10) === 465;
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(smtpPort, 10),
            secure: isSecure,
            auth: {
                user: user,
                pass: pass
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        const mailOptions = {
            from: user,
            to: to,
            subject: subject
        };

        if (contentType && contentType.toUpperCase() === 'HTML') {
            mailOptions.html = body;
        } else {
            mailOptions.text = body;
        }

        const info = await transporter.sendMail(mailOptions);
        return res.status(200).json({ success: true, messageId: info.messageId });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};
