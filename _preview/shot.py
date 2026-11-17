from playwright.sync_api import sync_playwright
import os
out = os.path.dirname(os.path.abspath(__file__))
base = "file:///" + out.replace("\\", "/")
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    shots = [
        ("home-desktop", "home.html", 1440, 900),
        ("home-mobile", "home.html", 380, 820),
        ("cards-desktop", "cards.html", 1440, 900),
        ("cards-mobile", "cards.html", 380, 820),
    ]
    for name, src, w, hh in shots:
        page = b.new_page(viewport={"width": w, "height": hh}, device_scale_factor=1)
        page.goto(base + "/" + src, wait_until="networkidle")
        page.evaluate("() => document.fonts.ready")
        page.wait_for_timeout(900)
        page.screenshot(path=os.path.join(out, name + ".png"), full_page=True)
        page.close()
    b.close()
print("shots done")