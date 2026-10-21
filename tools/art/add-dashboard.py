# Draws docs/images/add-dashboard/dashboard-{light,dark}.svg: the 3D Home picture for Home Assistant's Add dashboard dialog,
# in the style of its built-in pictures (160x160, grey line art, one #03A9F4 accent). Run: python3 tools/art/add-dashboard.py
import sys, os
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "../../docs/images/add-dashboard")
def P(u, v, z=0):
    return (80 + (u - v - 10) * 0.74, 60 + (u + v) * 0.37 - z)
def poly(pts, **a):
    d = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    return f'<polygon points="{d}" {attrs(a)}/>'
def attrs(a): return " ".join(f'{k.replace("_","-")}="{v}"' for k, v in a.items())
def wall(u1, v1, u2, v2, h, ink):
    # vertical face + top edge
    face = [P(u1, v1), P(u2, v2), P(u2, v2, h), P(u1, v1, h)]
    return poly(face, fill=ink, fill_opacity=0.07) + \
        f'<line x1="{P(u1,v1,h)[0]:.1f}" y1="{P(u1,v1,h)[1]:.1f}" x2="{P(u2,v2,h)[0]:.1f}" y2="{P(u2,v2,h)[1]:.1f}" stroke="{ink}" stroke-opacity="0.24" stroke-width="4" stroke-linecap="round"/>'
def svg(dark):
    ink = "white" if dark else "black"
    bg = '<path d="M0 8C0 3.582 3.582 0 8 0H152C156.418 0 160 3.582 160 8V152C160 156.418 156.418 160 152 160H8C3.582 160 0 156.418 0 152V8Z" fill="#1C1C1C"/><rect x="0.5" y="0.5" width="159" height="159" rx="7.5" stroke="white" stroke-opacity="0.24"/>' if dark else \
         '<rect width="160" height="160" rx="8" fill="white"/><rect x="0.5" y="0.5" width="159" height="159" rx="7.5" stroke="black" stroke-opacity="0.12"/>'
    H, h = 26, 5
    out = [bg]
    # L-shaped floor: 0..100 x 0..80 minus the front-right corner (deck)
    floor = [(0,0),(100,0),(100,48),(62,48),(62,80),(0,80)]
    out.append(poly([P(*p) for p in floor], fill=ink, fill_opacity=0.04, stroke=ink, stroke_opacity=0.12, stroke_width=5, stroke_linejoin="round"))
    # deck slats
    for i in range(4):
        v = 52 + i * 7
        a, b = P(66, v), P(96, v)
        out.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{ink}" stroke-opacity="0.12" stroke-width="4" stroke-linecap="round"/>')
    # glow of a lit lamp in the lounge (the one accent)
    gx, gy = P(30, 60)
    out.append(f'<ellipse cx="{gx:.1f}" cy="{gy:.1f}" rx="30" ry="16" fill="#03A9F4" fill-opacity="0.16"/>')
    out.append(f'<ellipse cx="{gx:.1f}" cy="{gy:.1f}" rx="16" ry="8.5" fill="#03A9F4" fill-opacity="0.22"/>')
    # back walls, full height (drawn back to front)
    out.append(wall(0, 80, 0, 0, H, ink))
    out.append(wall(0, 0, 100, 0, H, ink))
    out.append(wall(100, 0, 100, 48, H, ink))
    # interior walls with door gaps
    out.append(wall(62, 0, 62, 16, H, ink)); out.append(wall(62, 30, 62, 48, H, ink))
    out.append(wall(0, 40, 14, 40, H, ink)); out.append(wall(28, 40, 62, 40, H, ink))
    # cutaway front walls
    out.append(wall(100, 48, 62, 48, h, ink)); out.append(wall(62, 48, 62, 80, h, ink)); out.append(wall(0, 80, 62, 80, h, ink))
    # lamp: blue bulb above the glow
    bx, by = P(30, 60, 14)
    out.append(f'<line x1="{gx:.1f}" y1="{gy:.1f}" x2="{bx:.1f}" y2="{by+4:.1f}" stroke="{ink}" stroke-opacity="0.32" stroke-width="2" stroke-linecap="round"/>')
    out.append(f'<circle cx="{bx:.1f}" cy="{by:.1f}" r="6" fill="#03A9F4"/>')
    # status chips, grey like the Map picture's markers
    for (u, v, z) in [(82, 22, 10), (22, 18, 10)]:
        x, y = P(u, v, z)
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="{ink}" fill-opacity="0.32"/>')
    body = "".join(out)
    return f'<svg width="160" height="160" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">{body}</svg>\n'
for t in ("light", "dark"):
    open(os.path.join(OUT, f"dashboard-{t}.svg"), "w").write(svg(t == "dark"))
