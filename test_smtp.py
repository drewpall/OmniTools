import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import ssl

def test_send():
    user = 'drewpall@163.com'
    password = 'PYgn633AXQ7jneYc'
    host = 'smtp.163.com'
    port = 465
    to_addr = 'drewpall@163.com'
    subject = 'OmniTools Test Email'
    body = 'Hello, this is a test from Antigravity SMTP verification.'
    
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = user
    msg['To'] = to_addr
    msg.attach(MIMEText(body, 'plain', 'utf-8'))

    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE

    print("Connecting via SMTP_SSL to smtp.163.com:465...")
    try:
        server = smtplib.SMTP_SSL(host, port, timeout=15, context=context)
        server.set_debuglevel(1)
        print("Connected! Logging in...")
        server.login(user, password)
        print("Login successful! Sending mail...")
        server.sendmail(user, [to_addr], msg.as_string())
        server.quit()
        print("SUCCESS!")
    except Exception as e:
        print("FAILED with SSL:", e)
        print("Trying Port 25 or 587 without SSL but with STARTTLS...")
        try:
            server = smtplib.SMTP(host, 25, timeout=15)
            server.starttls(context=context)
            server.login(user, password)
            server.sendmail(user, [to_addr], msg.as_string())
            server.quit()
            print("SUCCESS via 25/STARTTLS!")
        except Exception as e2:
            print("FAILED with STARTTLS:", e2)

if __name__ == '__main__':
    test_send()
