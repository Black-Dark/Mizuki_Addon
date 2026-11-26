"""Build the Bedrock models and painted atlases from the companion art direction.
Requires Python with Pillow and NumPy. The result replaces the artwork archive.
"""
from copy import deepcopy
from io import BytesIO
from math import cos, sin, radians
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import textwrap
import argparse

import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
RP = REPO / "resource_pack"
original = json.loads((RP / "models/entity/mizuki.geo.json").read_text())["minecraft:geometry"][0]
original_texture = Image.open(RP / "textures/entity/mizuki.png").convert("RGBA")
faces = ("north", "south", "west", "east", "up", "down")

class Model:
    def __init__(self, style):
        self.image = Image.new('RGBA', (256, 256))
        self.image.paste(original_texture, (0, 0))
        self.model = deepcopy(original)
        self.model['description'].update(identifier=f'geometry.ochub.{style}', texture_width=256, texture_height=256,
                                         visible_bounds_width=3, visible_bounds_height=2.75)
        self.bones = {bone['name']: bone for bone in self.model['bones']}
        for name, bone in self.bones.items():
            if name not in ('backpack', 'pickaxe', 'axe'):
                bone.pop('cubes', None)
            if 'rhinophore' in name:
                bone.pop('rotation', None)
        self.x, self.y, self.row = 2, 130, 0
        self.patches = {}

    def patch(self, tile):
        if isinstance(tile, str):
            tile = Image.new('RGBA', (1, 1), tile)
        if tile is None:
            tile = Image.new('RGBA', (1, 1))
        key = (tile.size, tile.tobytes())
        if key in self.patches:
            return self.patches[key]
        w, h = tile.size
        if self.x + w + 1 > self.image.width:
            self.x, self.y, self.row = 2, self.y + self.row + 2, 0
        assert self.y + h + 1 <= self.image.height
        # Extrude the patch edge so adjacent colors cannot bleed into its UVs.
        self.image.paste(tile.resize((w+2,h+2), Image.Resampling.NEAREST), (self.x-1,self.y-1))
        self.image.paste(tile, (self.x, self.y))
        for x in range(w):
            self.image.putpixel((self.x+x,self.y-1),tile.getpixel((x,0)))
            self.image.putpixel((self.x+x,self.y+h),tile.getpixel((x,h-1)))
        for y in range(h):
            self.image.putpixel((self.x-1,self.y+y),tile.getpixel((0,y)))
            self.image.putpixel((self.x+w,self.y+y),tile.getpixel((w-1,y)))
        uv = {'uv': [self.x, self.y], 'uv_size': [w, h]}
        self.patches[key] = uv
        self.x += w + 2
        self.row = max(self.row, h)
        return uv

    def add_bone(self, name, parent, pivot):
        bone = {'name': name, 'parent': parent, 'pivot': pivot}
        self.model['bones'].append(bone)
        self.bones[name] = bone

    def box(self, bone, origin, size, base, *, front=None, back=None, side=None, top=None, base_down=None, turn=None):
        colors = (base if front is None else front, base if back is None else back,
                  side or base, side or base, top or base, base_down or side or base)
        cube = {'origin': origin, 'size': size, 'uv': {face: self.patch(tile) for face, tile in zip(faces, colors)}}
        if turn:
            cube['pivot'], cube['rotation'] = turn
        self.bones[bone].setdefault('cubes', []).append(cube)


def tile(size, color):
    image = Image.new('RGBA', size, color)
    return image, ImageDraw.Draw(image)


def star(draw, x, y, color):
    draw.line((x-2,y,x+2,y),fill=color)
    draw.line((x,y-2,x,y+2),fill=color)
    draw.point((x,y),fill='#f4f6fb')


def rotation(angles):
    x,y,z = map(radians, angles)
    return (np.array([[cos(z),-sin(z),0],[sin(z),cos(z),0],[0,0,1]]) @
            np.array([[cos(y),0,sin(y)],[0,1,0],[-sin(y),0,cos(y)]]) @
            np.array([[1,0,0],[0,cos(x),-sin(x)],[0,sin(x),cos(x)]]))

def render(model, tex, yaw, *, tool=None):
    size, scale = 260, 7.6
    tex = np.array(tex)
    cam = rotation((-10, yaw, 0))
    def project(p):
        x,y,z = cam @ p
        return np.array([x*scale+size/2,218-y*scale,z])
    out = np.zeros((size,size,4),dtype=np.uint8)
    dbuf = np.full((size,size),np.inf)
    bones = {b['name']:b for b in model['bones']}
    for bone in bones.values():
        if bone['name'] in ('pickaxe','axe') and bone['name'] != tool:
            continue
        for c in bone.get('cubes',[]):
            x,y,z = np.array(c['origin'])-c.get('inflate',0)
            X,Y,Z = np.array(c['origin'])+c['size']+c.get('inflate',0)
            verts = [(x,y,z),(X,y,z),(X,Y,z),(x,Y,z),(x,y,Z),(X,y,Z),(X,Y,Z),(x,Y,Z)]
            T = (('north',(3,2,0),1.0),('south',(6,7,5),.88),('west',(7,3,4),.78),
                 ('east',(2,6,1),.86),('up',(7,6,3),1.09),('down',(0,1,4),.68))
            def turn(p, part):
                if 'rotation' not in part:
                    return p
                pivot = np.array(part['pivot'])
                return rotation(part['rotation']) @ (p-pivot)+pivot
            n = bone
            vv = [turn(np.array(p),c) for p in verts]
            while n:
                vv = [turn(p,n) for p in vv]
                n = bones.get(n.get('parent'))
            vv = [project(p) for p in vv]
            for face, inds, light in T:
                if face not in c['uv']:
                    continue
                a,b,d = (vv[i] for i in inds)
                u,v = b-a,d-a
                matrix = np.stack((u[:2],v[:2]),axis=-1)
                det = np.linalg.det(matrix)
                if det <= 1e-5:
                    continue
                ps = np.array([a,b,d,b+d-a])
                x1,y1 = np.maximum(np.floor(ps[:,:2].min(0)).astype(int),0)
                x2,y2 = np.minimum(np.ceil(ps[:,:2].max(0)).astype(int),size)
                yy,xx = np.mgrid[y1:y2,x1:x2]
                uv = np.stack((xx+.5-a[0],yy+.5-a[1]),axis=-1) @ np.linalg.inv(matrix).T
                U,V = uv[:,:,0],uv[:,:,1]
                zval = a[2]+u[2]*U+v[2]*V
                mask = (U>=0)&(V>=0)&(U<1)&(V<1)
                mask &= zval < dbuf[yy,xx]
                yy,xx = yy[mask],xx[mask]
                tx,ty = c['uv'][face]['uv']
                w,h = c['uv'][face]['uv_size']
                color = tex[ty+np.floor(V[mask]*h).astype(int),tx+np.floor(U[mask]*w).astype(int)].copy()
                alpha = color[:,3] > 127
                color[:,:3] = np.clip(color[:,:3]*light,0,255).astype(np.uint8)
                out[yy[alpha],xx[alpha]] = color[alpha]
                dbuf[yy[alpha],xx[alpha]] = zval[mask][alpha]
    return Image.fromarray(out)


def mix(first, second, amount):
    a, b = ImageColor.getrgb(first), ImageColor.getrgb(second)
    return '#'+''.join(f'{round(x+(y-x)*amount):02x}' for x,y in zip(a,b))


def shade(color, amount):
    return mix(color, '#f9edf6' if amount > 0 else '#151523', abs(amount))


def coat_panel(m, bone, origins, size, cloth, trim, angle, pivot):
    panel, d = tile((16, 24), cloth)
    d.line([(1,0),(1,19),(5,22),(15,22)], fill=trim)
    d.line([(4,0),(4,15),(8,19)], fill=shade(cloth, .24))
    d.line([(13,2),(11,10),(11,19)], fill=shade(cloth, -.24))
    m.box(bone, origins, size, shade(cloth,-.16), front=panel, back=panel,
          turn=(pivot, angle))


def build_model(icon, design):
    colors, haircut, costume, features, expression = design.split('|')
    hair, streak, skin, iris, cloth, trim = ('#'+c for c in colors.split())
    features = set(features.split(','))
    shade_hair, high_hair = shade(hair,-.27), shade(hair,.21)
    cloth_dark, cloth_high = shade(cloth,-.35), shade(cloth,.2)
    face_dark = mix(skin,'#a96870',.38)
    m = Model(icon)
    m.model['description'].update(visible_bounds_width=3.2, visible_bounds_height=2.75)

    # Separate laid-out pixels for both eyes, the brows, and the expression.
    face, d = tile((28,22),skin)
    d.rectangle((0,0,27,4),fill=shade(skin,-.12))
    d.line((0,7,0,20),fill=face_dark)
    d.line((27,7,27,20),fill=face_dark)
    d.line((1,21,26,21),fill=face_dark)
    lid, tilt, mouth = {
        'stern':(10,-2,'line'), 'shy':(10,0,'small'), 'grin':(9,0,'open'),
        'soft':(10,1,'smile'), 'smirk':(10,-1,'smirk'), 'slant':(11,-1,'line'),
        'blank':(10,0,'line'), 'tired':(12,1,'small')
    }[expression]
    for index, x in enumerate((3,16)):
        u = (lambda n: x+n) if index == 0 else (lambda n: x+8-n)
        d.line([(u(0),lid-3+tilt),(u(6),lid-3),(u(8),lid-2)],fill=shade_hair)
        d.polygon([(u(0),lid+tilt),(u(8),lid),(u(7),16),(u(1),16)],fill='#fcf3ed')
        d.rectangle((x+2,lid+1,x+6,15),fill=shade(iris,-.27))
        d.rectangle((x+2,14,x+6,15),fill=iris)
        d.point((x+3,lid+2),fill='#fff5f7')
        d.line([(u(0),lid+tilt),(u(4),lid),(u(8),lid),(u(8),lid+1)],fill='#2e2534')
        if expression in ('shy','soft','grin'):
            d.line((x,17,x+2,17),fill=mix(skin,'#e88d9b',.58))
    d.point((14,16),fill=face_dark)
    color = mix(skin,'#7b354a',.65)
    strokes = {'line':[(12,18),(16,18)], 'small':[(13,19),(15,19)],
               'smile':[(11,18),(13,19),(16,19),(17,18)], 'smirk':[(11,19),(15,19),(17,18)]}
    if mouth == 'open':
        d.polygon([(10,17),(17,17),(16,20),(12,20)],fill='#73394c')
        d.line((12,17,15,17),fill='#fff1e6')
        d.line((13,19,15,19),fill='#d88997')
    else:
        d.line(strokes[mouth],fill=color)
    if 'glasses' in features:
        for x in (2,15):
            d.rectangle((x,9,x+10,16),outline=shade(trim,-.45))
        d.line((12,11,15,11),fill=trim)
    head_side, d = tile((16,20),skin)
    d.line((15,6,15,19),fill=face_dark)
    d.rectangle((9,12,12,15),fill=face_dark)
    d.rectangle((10,12,11,14),fill=skin)
    m.box('head',[-4.45,14.5,-3.94],[8.9,7.25,8],skin,front=face,back=shade(skin,-.18),side=head_side)

    # Strand shapes use broad color clusters and highlights that follow the part.
    top, d = tile((24,22),hair)
    d.polygon([(1,14),(4,4),(14,1),(19,4),(10,8),(4,18)],fill=high_hair)
    for x in range(5,22,6):
        d.line([(x,4),(x-2,9),(x-2,16),(x-4,20)],fill=streak if x==11 else shade_hair)
    back, d = tile((24,20),hair)
    for x in (2,8,14,20):
        d.line([(x,1),(x+1,9),(x,18)],fill=shade_hair)
        d.line([(x+2,3),(x+3,8),(x+2,12)],fill=high_hair)
    m.box('head',[-4.64,20.3,-4.18],[9.28,2.35,8.55],hair,front=back,back=back,side=back,top=top)
    m.box('head',[-4.48,15.75,2.56],[8.96,5.4,1.7],hair,front=back,back=back,side=shade_hair)
    cuts = {
        'spike':[(-4.3,18,1.75,-20),(-2.9,19.1,1.8,37),(-.9,18.6,1.7,-21),(.8,18.5,1.4,23),(2.3,17.7,1.85,23)],
        'waves':[(-4.35,18.5,1.85,-26),(-3,19.1,1.8,-42),(-1.35,19.25,2.0,35),(.7,18.5,1.8,30),(2.7,17.7,1.5,19)],
        'bob':[(-4.22,17.8,1.7,-13),(-2.7,19.1,1.9,14),(-.8,19.3,1.8,25),(1,18.65,1.8,20),(2.72,17.8,1.53,10)],
        'long':[(-4.25,16.6,1.9,-25),(-2.35,19.4,1.9,-30),(-.55,19.4,1.7,-27),(1.25,18.4,1.65,24),(2.85,16.9,1.63,21)],
        'swept':[(-4.1,17.6,1.95,-36),(-2.5,18.6,2,-33),(-.65,19.25,1.9,-34),(1.25,19.6,1.6,-22),(2.9,18.3,1.4,11)],
        'split':[(-4.38,17.7,1.8,-24),(-2.75,18.6,2.05,-33),(-.95,19.7,1.48,-30),(1.3,18.65,1.65,33),(2.8,17.6,1.55,29)],
        'braid':[(-4.45,17.0,1.7,-15),(-3,18.8,1.55,-22),(-1.4,19.6,1.7,-15),(.65,19.3,1.7,37),(2.65,17.5,1.5,16)],
        'tie':[(-4.3,18.5,1.85,-27),(-2.7,19.2,1.9,32),(-.8,19.3,1.4,34),(1,19.15,1.25,24),(2.6,18.15,1.6,17)]
    }
    for index,(x,y,w,angle) in enumerate(cuts[haircut]):
        base = streak if haircut == 'split' and index > 2 else hair
        lock, d = tile((8,12),base)
        d.polygon([(0,0),(5,0),(4,4),(2,9),(0,10)],fill=shade(base,.15))
        d.line([(3,2),(2,5),(1,8)],fill=streak if index == 2 else shade(base,.24))
        d.line([(7,3),(6,8),(4,11)],fill=shade(base,-.25))
        m.box('head',[x,y,-4.78-index*.014],[w,22-y,1.4],base,front=lock,side=shade(base,-.18),
              turn=([x+w/2,21.2,-4.05],[0,0,angle]))
    for side in (-1,1):
        x = -4.88 if side < 0 else 3.87
        long = haircut in ('bob','long','braid')
        m.box('head',[x,16.6 if long else 17.5,-3.62],[1.15,5.0 if long else 4.15,7.5],
              shade_hair,side=back,turn=([side*4.34,20.4,1.6],[0,0,side*-9]))
        if haircut == 'long':
            m.box('head',[x-side*.2,12.4,1.48],[1.65,7.3,2.4],hair,front=back,side=back,
                  turn=([side*4.15,18.2,2.1],[12,0,side*-9]))
        if haircut in ('spike','waves'):
            m.box('head',[side*3.15-.8,21.05,.16],[1.65,2.75,2.4],hair,top=streak,front=back,
                  turn=([side*3.15,21.4,.9],[20,0,side*-33]))
    if haircut in ('braid','tie'):
        for index in range(3):
            x = 3.55-index*.17
            y = 15.8-index*2.0
            m.box('head',[x,y,3.51],[1.75-index*.19,2.3,1.55],hair,front=back,back=back,
                  turn=([x+.6,y+1.9,3.8],[10,0,-12]))
        m.box('head',[3.5,13.6,3.52],[1.75,.52,1.5],trim)
    if 'earring' in features:
        m.box('head',[-4.82,14.7,-1.94],[.48,1.8,.54],trim,top=shade(trim,.34))
        m.box('head',[-4.92,14.55,-2.0],[.66,.54,.64],shade(trim,.34))

    # Outfit patterns are sewn into the torso, cuff and boots separately.
    jacket, d = tile((24,22),cloth)
    d.polygon([(0,0),(9,1),(6,7),(1,12),(0,11)],fill=cloth_high)
    d.polygon([(23,0),(15,1),(17,7),(22,12),(23,11)],fill=cloth_high)
    d.line((1,0,1,21),fill=cloth_dark)
    d.line((22,0,22,21),fill=cloth_dark)
    formal = costume in ('royal','tailcoat','cloak','coat','uniform')
    if formal:
        d.polygon([(8,0),(15,0),(14,10),(11,15),(9,12)],fill=shade(cloth,.54))
        d.line([(5,1),(10,8),(9,18),(5,21)],fill=trim,width=2)
        d.line([(18,1),(13,8),(14,18),(18,21)],fill=trim,width=2)
        d.rectangle((4,15,19,17),fill=cloth_dark)
        d.rectangle((10,15,13,17),outline=trim)
        for x,y in [(5,4),(18,4),(7,9),(16,9),(7,13),(16,13)]:
            d.point((x,y),fill=shade(trim,.36))
    elif costume in ('armor','guard'):
        d.polygon([(3,4),(7,2),(16,2),(20,4),(17,11),(6,11)],fill=cloth_dark)
        d.line([(3,4),(7,2),(16,2),(20,4),(17,11)],fill=trim)
        d.line([(4,12),(7,15),(16,15),(19,12)],fill=cloth_high,width=2)
        d.rectangle((1,17,22,19),fill=cloth_dark)
        d.rectangle((10,17,13,19),outline=trim)
    elif costume == 'knit':
        for x in range(3,22,4):
            d.line([(x,4),(x+1,8),(x,11),(x+1,15),(x,21)],fill=cloth_dark)
        d.rectangle((0,17,23,21),fill=cloth_high)
    else:
        d.line((11,4,11,20),fill=cloth_dark,width=2)
        d.line((8,3,8,10),fill=trim)
        d.line((15,3,15,8),fill=trim)
        d.line((3,13,8,15),fill=cloth_high,width=2)
        d.line((19,13,14,15),fill=cloth_high,width=2)
    if 'sash' in features:
        d.line([(1,6),(7,10),(15,13),(22,15)],fill=trim,width=2)
    if 'chain' in features:
        d.line([(6,3),(9,7),(13,9),(17,5)],fill=shade(trim,.45))
        d.line((13,8,13,13),fill=trim)
        d.line((11,10,15,10),fill=trim)
    if 'straps' in features:
        d.line([(3,1),(6,7),(10,11),(20,18)],fill=shade(cloth,-.6),width=3)
        d.rectangle((6,6,8,8),outline=trim)
    if 'star' in features:
        star(d,5,8,trim)
    if 'rose' in features:
        d.rectangle((4,7,7,10),fill=shade(trim,-.3))
        d.point((5,8),fill=shade(trim,.4))
    if 'moon' in features:
        d.arc((3,6,9,12),40,310,fill=shade(trim,.55),width=2)
    m.box('body',[-3.85,7.8,-2.48],[7.7,6.9,4.96],cloth,front=jacket,back=cloth_dark,side=cloth_dark,top=cloth_high)
    m.box('body',[-3.92,7.05,-2.57],[7.84,1.15,5.14],cloth_dark)
    if costume in ('hoodie','cloak','knit') or 'scarf' in features:
        collar = trim if 'scarf' in features else cloth_high
        m.box('body',[-3.72,13.0,-2.63],[7.44,1.28,5.35],collar,side=shade(collar,-.18))
        if 'scarf' in features:
            m.box('body',[1.2,9.2,-2.97],[1.48,4.18,.54],trim,
                  turn=([1.45,13.0,-2.65],[0,0,-16]))
    for side,name in [(-1,'right'),(1,'left')]:
        arm,leg=name+'_arm',name+'_leg'
        x=-6.73 if side<0 else 3.75
        sleeve,d=tile((10,16),cloth)
        d.line((1,1,1,13),fill=cloth_high)
        d.line((8,2,8,14),fill=cloth_dark)
        d.rectangle((0,12,9,13),fill=trim if costume in ('royal','tailcoat','guard') or 'cuff' in features else cloth_high)
        d.point((5,14),fill=trim)
        m.box(arm,[x,7.35,-1.86],[2.98,6.8,3.72],cloth,front=sleeve,side=cloth_dark)
        m.box(arm,[x+.36,6.10,-1.43],[2.2,1.32,2.86],skin,side=face_dark)
        if costume in ('armor','royal','guard','tailcoat'):
            pad=trim if costume=='royal' else cloth_high
            m.box(arm,[x-.17,12.37,-2.02],[3.32,1.9,4.06],pad,side=cloth_dark,top=shade(pad,.23),
                  turn=([side*4.9,13.85,0],[0,0,side*-7]))
        xx=-3.57 if side<0 else .25
        pants=shade(cloth,-.41 if formal else -.24)
        if "lightpants" in features:
            pants=shade(cloth,.23)
        elif "darkpants" in features:
            pants=shade(trim,-.66)
        leg_face,d=tile((10,16),pants)
        d.line((1,1,1,13),fill=cloth_high)
        if "shorts" in features:
            d.rectangle((0,7,9,13),fill=skin)
            d.line((0,7,9,7),fill=face_dark)
            d.line((0,14,9,14),fill=trim)
        if "asym" in features and side < 0:
            d.line([(1,3),(7,5),(8,10),(4,12)],fill=trim,width=2)
        if 'pocket' in features or costume in ('armor','street','guard'):
            d.rectangle((4,4,8,8),fill=cloth_dark,outline=cloth_high)
        if "shorts" in features:
            side_view, side_draw=tile((8,16),shade(pants,-.25))
            side_draw.rectangle((0,7,7,13),fill=face_dark)
            side_draw.line((0,14,7,14),fill=trim)
        else:
            side_view=shade(pants,-.25)
        m.box(leg,[xx,1.3,-1.76],[3.32,6.46,3.52],pants,front=leg_face,side=side_view)
        boot=shade(cloth,-.54 if costume!='knit' else -.2)
        boot_face,d=tile((10,8),boot)
        d.line((1,6,8,6),fill=cloth_high)
        d.line((3,2,6,2),fill=trim)
        d.line((3,4,6,4),fill=trim)
        m.box(leg,[xx-.075,0,-2.48],[3.47,2.05 if formal else 1.76,4.33],boot,
              front=boot_face,side=shade(boot,-.17))
        if costume in ('royal','tailcoat','coat','cloak'):
            length={'royal':6.2,'tailcoat':6.5,'coat':5.3,'cloak':6.5}[costume]
            base_y=8.6-length+(1.2 if costume=='tailcoat' and side>0 else 0)
            coat_panel(m,leg,[xx+(-1.36 if side<0 else .69),base_y,1.3],
                       [3.95,8.6-base_y,.72],cloth,trim,[12,side*8,side*18],[side*2.55,8,1.4])
            if costume != 'cloak':
                coat_panel(m,leg,[xx+(-.6 if side<0 else 1.86),3.0,-2.1],
                           [1.95,4.75,.41],cloth,trim,[0,0,side*9],[side*2.75,7.8,-1.85])
    if costume == 'cloak':
        for side in (-1,1):
            coat_panel(m,'body',[-3.94 if side<0 else .15,4.15,2.8],[3.8,9.0,.61],cloth,trim,
                       [17,0,side*-13],[side*2.25,12.6,2.94])
        m.box('body',[-4.07,12.1,1.53],[8.14,2.1,2.1],cloth_high)
    return add_features(m, features, hair, streak, cloth, trim, iris)


def add_features(m, features, hair, streak, cloth, trim, eyes):
    dark, light = shade(hair,-.28), shade(hair,.24)
    for pos,side in [(-1,'right'),(1,'left')]:
        bone = side+'_rhinophore'
        if features & {'cat','wolf','dog','round'}:
            kind = next(k for k in ('cat','wolf','dog','round') if k in features)
            outward, height = {'cat':(.77,3.35),'wolf':(1.03,3.6),'dog':(1.55,1.4),'round':(.54,2.25)}[kind]
            inner = mix(light, '#e7a5a9', .38)
            for step in range(3):
                width = (2.6,1.97,1.18)[step] if kind!='round' else (2.34,2.34,1.61)[step]
                x = pos*(3.35+outward*step*.46)
                y = 21.5+height*step*.25
                ear,d = tile((8,6),dark)
                if step < 2: d.rectangle((2,0,5,5),fill=inner)
                m.box(bone,[x-width/2,y,-2.12],[width,height*.43,1.6-step*.18],hair,front=ear,side=dark,
                      turn=([pos*3.5,21.6,-1.4],[0,0,pos*(20 if kind=='dog' else -8)]))
        if features & {'horns','antlers','tallhorns'}:
            horn = trim if 'antlers' not in features else shade(trim,.4)
            length = 5.1 if 'tallhorns' in features else 3.4
            for i in range(4):
                x = pos*(3.35+i*.35); w = 1.61-i*.33; y=21.66+length*i/4
                m.box(bone,[x-w/2,y,-1.63],[w,length*.34,1.4-i*.21],shade(horn,-.38),
                      front=horn if i>1 else shade(horn,-.16),top=shade(horn,.28),
                      turn=([x,y,-1.2],[0,0,pos*[-18,-25,-12,7][i]]))
            if 'antlers' in features:
                m.box(bone,[pos*4.27-.35,22.56,-1.48],[.72,2.7,.72],horn,
                      turn=([pos*4.27,22.56,-1.1],[0,0,pos*-37]))
                m.box(bone,[pos*4.93-.28,24.0,-1.58],[.56,1.65,.61],shade(horn,.28),
                      turn=([pos*4.93,24.04,-1.3],[0,0,pos*-30]))
    if 'halo' in features:
        ring,d=tile((20,18),None)
        d.ellipse((0,1,19,16),outline=shade(trim,.65),width=3)
        d.arc((1,2,18,15),190,310,fill='#ffffff',width=1)
        empty=Image.new('RGBA',(1,1))
        m.box('head',[-4.45,24,-3.65],[8.9,.18,7.75],empty,top=ring,base_down=ring,
              turn=([0,24,0],[27,0,-8]))
    if features & {'headhood','hat','wizardhat'}:
        if 'headhood' in features:
            for sign in (-1,1):
                x=-5.0 if sign<0 else 3.65
                m.box('head',[x,16.0,-3.82],[1.43,5.57,8.2],cloth,front=trim,side=shade(cloth,-.1))
            m.box('head',[-5.05,21.55,-4.1],[10.1,.86,8.7],shade(cloth,.23),front=trim,side=cloth)
            m.box('head',[-4.42,22.12,-3.39],[8.84,1.0,7.05],shade(cloth,.2),front=shade(trim,.22),side=cloth)
            m.box('head',[-4.63,16.2,2.1],[9.26,6.1,2.25],cloth,back=shade(cloth,-.3))
        else:
            wizard='wizardhat' in features
            pivot=[0,22.65,0]
            tilt=[8,0,-13 if wizard else 13]
            for x,y,z,w,h,depth,color in [
                (-5.85,22.14,-4.7,11.7,.46,10.15,shade(cloth,-.3)),
                (-3.02,22.6,-2.49,6.04,1.38,5.5,cloth),
                (-3.0,22.65,-2.5,6.0,.51,5.55,trim),
                (-2.28,23.65,-1.79,4.58,1.34,4.3,cloth),
                (-1.5,24.64,-1.13,3.3,1.29,3.07,shade(cloth,.13)),
                (-.5,25.69,-.64,1.79,1.27,1.9,shade(cloth,.2))]:
                m.box('head',[x,y,z],[w,h,depth],color,side=shade(color,-.24),turn=(pivot,tilt))
    wings=next((k for k in ('wings_dark','wings_light','wings_blue','wings_void','flame_wings','wings_cream') if k in features),None)
    if wings:
        color = {'wings_dark':'#53516e','wings_light':'#d9e9fa','wings_blue':'#4d75a9',
                 'wings_void':'#3c3c94','flame_wings':trim,'wings_cream':'#e9d7b1'}[wings]
        wing,d=tile((30,26),None)
        membrane=wings in ('flame_wings','wings_void')
        if membrane:
            shape=[(0,13),(6,7),(16,2),(29,1),(26,5),(24,14),(25,21),(20,18),(16,18),(13,24),(9,19),(5,18),(0,20)]
            d.polygon(shape,fill=shade(color,-.24),outline=shade(color,.4))
            for vein in [[(0,13),(15,3),(13,23)],[(3,17),(26,3),(24,20)]]:
                d.line(vein,fill=color,width=2)
            if wings=='wings_void':
                for x,y in [(11,10),(20,9),(23,15)]: star(d,x,y,shade(color,.42))
        else:
            for f,(ex,ey) in enumerate([(29,5),(29,10),(27,15),(25,19),(21,23),(17,25)]):
                d.polygon([(0,8+f),(7,5+f),(ex-4,ey-3),(ex,ey),(ex-7,ey+1),(5,13+f)],
                          fill=shade(color, .28-f*.13),outline=shade(color,-.24))
            d.line([(2,10),(14,7),(23,5)],fill=shade(color,.53),width=2)
        for sign,name in [(-1,'right'),(1,'left')]:
            bone=name+'_wing'
            pivot=[sign*2.6,12.6,3.45]
            m.add_bone(bone,'body',pivot)
            pattern=wing if sign>0 else wing.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            empty=Image.new('RGBA',(1,1))
            m.box(bone,[2.25 if sign>0 else -14.45,6.85,3.48],[12.2,12.15,.34],empty,
                  front=pattern,back=pattern.transpose(Image.Transpose.FLIP_LEFT_RIGHT),
                  turn=(pivot,[0,sign*-18,sign*-9]))
    if features & {'tail','longtail','shadowtail'}:
        base=shade(hair,-.13)
        m.add_bone('tail','body',[0,8,2.7])
        tail,d=tile((10,10),base)
        d.line([(1,0),(2,4),(2,9)],fill=light,width=2)
        d.line((8,1,8,8),fill=dark)
        if 'shadowtail' in features:
            star(d,5,4,trim)
        sections=[(-.55,6.1,2.7,2.0,2.98,-14),(-2.11,5.3,3.3,1.88,3.0,-73),(-4.44,5.55,4.0,1.85,3.0,-93),
                  (-6.47,6.65,4.05,1.7,2.95,-37),(-7.05,8.37,4.0,1.6,2.2,16)]
        if 'longtail' in features or 'shadowtail' in features:
            sections += [(-7.82,9.65,4.13,1.4,2.7,47),(-9.32,10.65,4.14,1.16,1.8,64)]
        for x,y,z,w,h,angle in sections:
            m.box('tail',[x-w/2,y-h/2,z],[w,h,1.72],base,front=tail,back=tail,side=tail,
                  turn=([x,y,z],[0,0,angle]))
    if 'staff' in features:
        m.box('left_arm',[5.1,1.5,-2.56],[.64,13.3,.64],shade(trim,-.24),
              turn=([5.4,6.8,-1.7],[13,0,-11]))
        m.box('left_arm',[6.11,13.45,-.66],[1.97,2.12,.97],shade(trim,.55),front=eyes,
              turn=([7.1,14.55,-.38],[0,0,45]))
    if 'scabbard' in features:
        m.box('body',[-4.62,3.53,.62],[.71,7.45,.83],shade(cloth,-.54),front=trim,
              turn=([-4.14,8.12,1.02],[13,0,-39]))
    if 'crystal' in features:
        m.box('body',[-4.12,12.4,1.41],[1.25,2.53,.98],trim,top=shade(trim,.42),
              turn=([-3.45,13.16,1.81],[0,0,-37]))
    if 'curl' in features:
        m.box('head',[-.91,22.35,-1.13],[1.48,1.94,1.45],streak,
              turn=([-.16,22.45,-.55],[17,0,36]))
    return m


def make_archive(output, preview=None):
    design = [line for line in (HERE/'archive-designs.tsv').read_text().splitlines() if line and not line.startswith('#')]
    client = json.loads((RP/'entity/mizuki.entity.json').read_text())['minecraft:client_entity']['description']
    render_data = json.loads((RP/'render_controllers/mizuki.render_controllers.json').read_text())
    controller = render_data['render_controllers']['controller.render.ochub.mizuki']
    icons = [key.split('.',1)[1] for key in controller['arrays']['geometries']['Array.variants'][9:]]
    assert len(icons) == len(design) == 50 and len(set(icons)) == len(icons)
    models=[]
    renders=[]
    def entry(archive,name,data):
        item=ZipInfo(name,(2026,1,1,0,0,0))
        archive.writestr(item,data,compress_type=ZIP_DEFLATED)
    def png(im):
        output=BytesIO()
        im.save(output,format='PNG',optimize=True)
        return output.getvalue()
    with ZipFile(output,'w') as archive:
        for icon, recipe in zip(icons,design):
            m=build_model(icon,recipe)
            m.model['description']['identifier']=client['geometry'][icon]
            models.append(m.model)
            front=render(m.model,m.image,-16)
            assert front.getbbox()
            sticker=front.crop(front.getbbox())
            sticker.thumbnail((61,61),Image.Resampling.LANCZOS)
            mini=Image.new('RGBA',(64,64))
            mini.paste(sticker,((64-sticker.width)//2,(64-sticker.height)//2))
            entry(archive,f'resource_pack/textures/entity/{icon}.png',png(m.image))
            entry(archive,f'resource_pack/textures/ui/companions/{icon}.png',png(mini))
            renders.append((icon, front))
        packed=json.dumps({'format_version':'1.12.0','minecraft:geometry':models},separators=(',',':'))
        entry(archive,'resource_pack/models/entity/oc_hub_chibis.geo.json',packed.encode())
    if preview:
        preview.mkdir(parents=True,exist_ok=True)
        font=ImageFont.truetype('DejaVuSans.ttf',15)
        for start in range(0,50,10):
            sheet=Image.new('RGB',(1110,543),'#202839')
            paint=ImageDraw.Draw(sheet)
            for i,(icon,im) in enumerate(renders[start:start+10]):
                x,y=i%5*222,i//5*270
                im.thumbnail((206,230),Image.Resampling.LANCZOS)
                sheet.paste(im,(x+(222-im.width)//2,y-5),im)
                label=icon[3:].rsplit('_',1)[0].replace('_',' ').title()
                for j,line in enumerate(textwrap.wrap(label,24)):
                    paint.text((x+111,y+218+j*19),line,font=font,anchor='mt',fill='#e8edf9')
            sheet.save(preview/f'Archive_Chibis_{start+1:02}-{start+10:02}.png')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--preview',type=Path)
    args=parser.parse_args()
    make_archive(REPO/'Chibi-Companions-Archive-Art.zip',args.preview)
