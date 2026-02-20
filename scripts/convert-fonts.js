// Convert TTF/OTF fonts to Three.js typeface.json format
const opentype = require('opentype.js');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function download(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
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
    original_font_information: {
      format: 0,
      copyright: '',
      fontFamily: familyName,
      fontSubfamily: 'Bold',
      uniqueID: familyName,
      fullName: familyName,
      postScriptName: familyName,
    },
    cssFontWeight: 'bold',
    cssFontStyle: 'normal',
  };

  // Convert needed chars: space, 0-9, A-Z, a-z, common punctuation
  const chars = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
  
  for (const char of chars) {
    const glyph = font.charToGlyph(char);
    if (!glyph || glyph.index === 0 && char !== ' ') continue;
    
    const charCode = char.charCodeAt(0);
    const glyphData = {
      x_min: Math.round((glyph.xMin || 0) * scale),
      x_max: Math.round((glyph.xMax || 0) * scale),
      ha: Math.round((glyph.advanceWidth || 0) * scale),
      o: ''
    };

    // Convert path commands
    const path = glyph.getPath(0, 0, 1000);
    let o = '';
    for (const cmd of path.commands) {
      switch (cmd.type) {
        case 'M':
          o += `m ${Math.round(cmd.x)} ${Math.round(cmd.y)} `;
          break;
        case 'L':
          o += `l ${Math.round(cmd.x)} ${Math.round(cmd.y)} `;
          break;
        case 'Q':
          o += `q ${Math.round(cmd.x1)} ${Math.round(cmd.y1)} ${Math.round(cmd.x)} ${Math.round(cmd.y)} `;
          break;
        case 'C':
          o += `b ${Math.round(cmd.x1)} ${Math.round(cmd.y1)} ${Math.round(cmd.x2)} ${Math.round(cmd.y2)} ${Math.round(cmd.x)} ${Math.round(cmd.y)} `;
          break;
        case 'Z':
          o += `z `;
          break;
      }
    }
    glyphData.o = o.trim();
    result.glyphs[String(charCode)] = glyphData;
  }

  return result;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'fonts');
  fs.mkdirSync(outDir, { recursive: true });

  // Google Fonts to download and convert
  const fonts = [
    {
      name: 'Playfair Display Bold',
      url: 'https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf',
      file: 'playfair_display_bold',
      category: 'Classic Serif'
    },
    {
      name: 'Roboto Bold', 
      url: 'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc4.woff2',
      file: 'roboto_bold',
      category: 'Sans Serif'
    },
    {
      name: 'Great Vibes',
      url: 'https://github.com/google/fonts/raw/main/ofl/greatvibes/GreatVibes-Regular.ttf',
      file: 'great_vibes',
      category: 'Connected Script'
    },
    {
      name: 'Black Ops One',
      url: 'https://github.com/google/fonts/raw/main/ofl/blackopsone/BlackOpsOne-Regular.ttf',
      file: 'black_ops_one',
      category: 'Stencil/Industrial'
    },
    {
      name: 'Poiret One',
      url: 'https://github.com/google/fonts/raw/main/ofl/poiretone/PoiretOne-Regular.ttf', 
      file: 'poiret_one',
      category: 'Art Deco'
    },
    {
      name: 'Pacifico',
      url: 'https://github.com/google/fonts/raw/main/ofl/pacifico/Pacifico-Regular.ttf',
      file: 'pacifico',
      category: 'Script/Cursive'
    },
  ];

  for (const f of fonts) {
    console.log(`Downloading ${f.name}...`);
    try {
      const buffer = await download(f.url);
      console.log(`  Downloaded ${buffer.length} bytes`);
      
      const font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      console.log(`  Parsed font: ${font.names.fontFamily?.en || f.name}`);
      
      // For variable fonts, we just use default weight
      const typeface = convertToTypeface(font, f.name);
      const outPath = path.join(outDir, `${f.file}.typeface.json`);
      fs.writeFileSync(outPath, JSON.stringify(typeface));
      console.log(`  Wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  // Also download Three.js optimer for a nice serif option
  console.log('Downloading Optimer Bold from Three.js CDN...');
  try {
    const buf = await download('https://cdn.jsdelivr.net/npm/three@0.175.0/examples/fonts/optimer_bold.typeface.json');
    fs.writeFileSync(path.join(outDir, 'optimer_bold.typeface.json'), buf);
    console.log('  Done');
  } catch (e) {
    console.error('  ERROR:', e.message);
  }

  console.log('\nAll done!');
}

main().catch(console.error);
