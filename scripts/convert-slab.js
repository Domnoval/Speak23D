const opentype = require('opentype.js');
const fs = require('fs');
const path = require('path');
const https = require('https');

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function convertToTypeface(font, familyName) {
  const scale = 1000 / font.unitsPerEm;
  const result = {
    glyphs: {},
    familyName: familyName,
    ascender: Math.round(font.ascender * scale),
    descender: Math.round(font.descender * scale),
    underlinePosition: Math.round((font.tables.post?.underlinePosition || -100) * scale),
    underlineThickness: Math.round((font.tables.post?.underlineThickness || 50) * scale),
    boundingBox: {
      xMin: Math.round((font.tables.head?.xMin || 0) * scale),
      yMin: Math.round((font.tables.head?.yMin || 0) * scale),
      xMax: Math.round((font.tables.head?.xMax || 0) * scale),
      yMax: Math.round((font.tables.head?.yMax || 0) * scale),
    },
    resolution: 1000,
    original_font_information: { format: 0, fontFamily: familyName, fontSubfamily: 'Bold', fullName: familyName },
    cssFontWeight: 'bold',
    cssFontStyle: 'normal',
  };
  const chars = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
  for (const char of chars) {
    const glyph = font.charToGlyph(char);
    if (!glyph || glyph.index === 0 && char !== ' ') continue;
    const glyphData = {
      x_min: Math.round((glyph.xMin || 0) * scale),
      x_max: Math.round((glyph.xMax || 0) * scale),
      ha: Math.round((glyph.advanceWidth || 0) * scale),
      o: ''
    };
    const p = glyph.getPath(0, 0, 1000);
    let o = '';
    for (const cmd of p.commands) {
      switch (cmd.type) {
        case 'M': o += `m ${Math.round(cmd.x)} ${Math.round(cmd.y)} `; break;
        case 'L': o += `l ${Math.round(cmd.x)} ${Math.round(cmd.y)} `; break;
        case 'Q': o += `q ${Math.round(cmd.x1)} ${Math.round(cmd.y1)} ${Math.round(cmd.x)} ${Math.round(cmd.y)} `; break;
        case 'C': o += `b ${Math.round(cmd.x1)} ${Math.round(cmd.y1)} ${Math.round(cmd.x2)} ${Math.round(cmd.y2)} ${Math.round(cmd.x)} ${Math.round(cmd.y)} `; break;
        case 'Z': o += `z `; break;
      }
    }
    glyphData.o = o.trim();
    result.glyphs[String(char.charCodeAt(0))] = glyphData;
  }
  return result;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'fonts');
  // Alfa Slab One - a proper slab serif, single weight (not variable)
  const url = 'https://github.com/google/fonts/raw/main/ofl/alfaslabone/AlfaSlabOne-Regular.ttf';
  console.log('Downloading Alfa Slab One...');
  const buffer = await download(url);
  console.log(`  Downloaded ${buffer.length} bytes`);
  const font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  console.log(`  Parsed: ${font.names.fontFamily?.en}`);
  const typeface = convertToTypeface(font, 'Alfa Slab One');
  const outPath = path.join(outDir, 'alfa_slab_one.typeface.json');
  fs.writeFileSync(outPath, JSON.stringify(typeface));
  console.log(`  Wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)}KB)`);
}
main().catch(console.error);
