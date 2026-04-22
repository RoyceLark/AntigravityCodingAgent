const fs = require('fs');
const path = require('path');

// 128x128 Transparent png with a blue circle
// Generated via simple base64 encoded PNG for a blue circle
const base64 = "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAMoSURBVHhe7doxTQMBAADQ/60FjIxMTMzAxsjEzMDGxoTExMDM0MTAxNDEwMDE0I/3uOftrtfLpfe+5y9JkiVJkiRJkna22+2+n8/n5/P5/Hw+n5/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fz+fz+Xw+n8/n8/l8Pp/P5/P5fD6fr9//9fX14/Pz8/P19fX55+fnx+fn5+fr6+vz9/f35+/v78/f39+fv7+/P39/f3/+/v7+/P39/fn7+/vz9/f35+/v78/f39+fv7+/P39/f3/+/v7+/P39/fn7+/vz9/f35+/v78/f39+fv7+/P39/f3/+/v7+/P39/fn7+/vz9/f35+/v78/f39+fv7+/P39/f3/+/v7+/P39/fn7+/vz9/f35+/v78/f39+fv7+/P39/f3/+luz2+32SJH2SJEmaAgwMDiCgYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYGCAYGBgYOAf2e33+yRJkiRJkiRJkv/YbD4=";

try {
    const buffer = Buffer.from(base64, 'base64');
    const targetPath = path.join(__dirname, 'media', 'icon.png');
    fs.writeFileSync(targetPath, buffer);
    console.log('Successfully generated media/icon.png');
} catch (e) {
    console.error('Failed to generate icon:', e);
    process.exit(1);
}
