import struct, zlib, base64

def create_png(size, bg, shield_color, check_color):
    """Create a minimal PNG with a shield + checkmark icon"""
    img = []
    for y in range(size):
        row = []
        for x in range(size):
            cx, cy = x - size/2, y - size/2
            nx, ny = cx/(size*0.38), cy/(size*0.42)
            # Shield shape: parabolic top + curved bottom
            in_shield = False
            if abs(nx) <= 1.0:
                if ny <= 0.5 and ny >= -0.9:
                    top = -0.9
                    bottom = 0.8 - 0.5*(nx**2)
                    if ny >= top and ny <= bottom:
                        # Shield sides slightly narrower at middle
                        side = 1.0 - 0.15 * max(0, ny)
                        if abs(nx) <= side:
                            in_shield = True
            if in_shield:
                # Draw checkmark
                # checkmark: (-.35,.1) -> (-.05,.4) -> (.4,-.25)
                d1 = point_to_segment(nx, ny, -0.35, 0.1, -0.05, 0.4)
                d2 = point_to_segment(nx, ny, -0.05, 0.4, 0.4, -0.25)
                d = min(d1, d2)
                thickness = 0.12
                if d < thickness:
                    row.extend(check_color)
                else:
                    row.extend(shield_color)
            else:
                row.extend(bg)
        img.append(bytes(row))
    return encode_png(size, size, img)

def point_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx-ax, by-ay
    lenSq = dx*dx + dy*dy
    if lenSq == 0: return ((px-ax)**2+(py-ay)**2)**0.5
    t = max(0, min(1, ((px-ax)*dx+(py-ay)*dy)/lenSq))
    return ((px-(ax+t*dx))**2+(py-(ay+t*dy))**2)**0.5

def encode_png(w, h, rows):
    def chunk(name, data):
        c = zlib.crc32(name+data) & 0xffffffff
        return struct.pack('>I',len(data))+name+data+struct.pack('>I',c)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    raw = b''.join(b'\x00'+r for r in rows)
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

# Dark background, amber shield, white check
bg = [15, 17, 23, 255]
shield = [245, 158, 11, 255]
check = [255, 255, 255, 255]

for size in [16, 48, 128]:
    data = create_png(size, bg, shield, check)
    with open(f'/home/claude/exam-audit-extension/icons/icon{size}.png', 'wb') as f:
        f.write(data)
    print(f"icon{size}.png — {len(data)} bytes")
