import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { AVATAR_SHAPES, AVATAR_PALETTE, COLORS, COLOR_LABELS, SHAPE_LABELS, characterVariant, characterLayers, avatarForeground } from "../frontend/src/presence/avatar-art.ts";
import { PERSONA_SHAPE_PATHS, personaShapePath } from "../frontend/src/presence/avatar-shapes.ts";

// Generated independently from b847068's recovered onboarding character,
// Git blob c24bed17ba019d96b061a1b5b26a4810a33d4616, before extraction.
const PATH_SHA256 = {
  "blob": "5b64df9ee915177324efed5b76e2f05ad9850c4a167c47be3747d194f169429c",
  "pebble": "a5228bfd03185a7c01d5f8d356ea1ba29a644dbac76bf569cfe25fe0f5e644ae",
  "squircle": "57d6bfdc6696a1c5786b59428e806dbf2b1f246846cbf012427b8f9457b5e765",
  "tablet": "c33b4ec7ee578d9408fa9c298fb289c495b8064221a289fb36f9e947fbd865cd",
  "wedge": "d77c28d8a728ffdc9b04a41cbfb66aad7e4e3c043a46cb5cc3b19aa791bdae42",
  "hex": "7d91f7e72305dc0e38afe6b79e9a271f184b5e44ee7a37428ea0af535955686d",
  "cloud": "8274d76a743613be93f29ff4bd1f4b9f894433d31e2edc4a3453ec4fd54f6c93",
  "teardrop": "35b510359aca5cb1044aca0897f13feba05959532d29857a89f72b62595884fa"
};
const expectedShapes = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"];
const expectedColors = [
  ["black", "Black", "#000000"], ["brown", "Brown", "#936439"],
  ["red", "Red", "#FF263C"], ["orange", "Orange", "#FF6700"],
  ["yellow", "Yellow", "#FF9800"], ["green", "Green", "#00C972"],
  ["cyan", "Cyan", "#00BCA6"], ["blue", "Blue", "#1084FE"],
  ["violet", "Violet", "#9159FE"], ["magenta", "Magenta", "#FF309B"],
  ["gray", "Gray", "#777777"],
];
function luminance(hex) {
  const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255)
    .map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}

test("original category order, labels and swatches cannot drift into theme colors", () => {
  assert.deepEqual(AVATAR_SHAPES, expectedShapes);
  assert.deepEqual(AVATAR_PALETTE.map(c => [c.id,c.label,c.value]), expectedColors);
  assert.deepEqual(Object.keys(COLOR_LABELS), expectedColors.map(c => c[0]));
  assert.deepEqual(Object.keys(SHAPE_LABELS), expectedShapes);
  for (const [id,label,value] of expectedColors) {
    assert.equal(COLORS[id],value);assert.equal(COLOR_LABELS[id][0],label);
  }
});

test("all eight body paths remain byte-exact to the pinned recovered geometry", () => {
  for (const shape of expectedShapes) {
    assert.equal(createHash("sha256").update(PERSONA_SHAPE_PATHS[shape]).digest("hex"),PATH_SHA256[shape]);
    const body=characterLayers(shape,"blue")[0];
    assert.equal(body.attrs.d,PERSONA_SHAPE_PATHS[shape]);
    assert.equal(body.attrs.transform,`scale(${64/259}) translate(15 15)`);
  }
  assert.equal(new Set(expectedShapes.map(characterVariant)).size,8);
  assert.equal(new Set(expectedShapes.map(s => characterLayers(s)[0].attrs.d)).size,8);
});

test("all 88 combinations preserve original identity and the five-part motion contract", () => {
  for (const shape of expectedShapes) for (const [color,,value] of expectedColors) {
    const layers=characterLayers(shape,color);
    assert.equal(AVATAR_SHAPES[characterVariant(shape)],shape);
    assert.equal(layers[0].attrs.fill,value);
    assert.deepEqual(layers.map(l => l.part),["body","detail","eyes","eyes","mouth"]);
    assert.deepEqual(layers,characterLayers(shape,color));
  }
});

test("hex and teardrop are selectable identities, not aliases of tablet or blob", () => {
  assert.notEqual(characterVariant("hex"),characterVariant("tablet"));
  assert.notEqual(characterVariant("teardrop"),characterVariant("blob"));
});

test("faces and selected color ticks have at least 4.5:1 contrast on every color", () => {
  for (const [id,,value] of expectedColors) {
    const [lo,hi]=[luminance(value),luminance(avatarForeground(id))].sort((a,b)=>a-b);
    assert.ok((hi+.05)/(lo+.05)>=4.5,id);
    assert.equal(characterLayers("blob",id)[2].attrs.fill,avatarForeground(id));
    assert.equal(characterLayers("blob",id)[4].attrs.stroke,avatarForeground(id));
  }
  assert.equal(avatarForeground("black"),"#FFFFFF");
});

test("legacy colors remain readable without additional duplicate choices", () => {
  for (const [old,current] of [["pink","magenta"],["purple","violet"],["teal","cyan"],["lime","green"],["grey","gray"]]) {
    assert.equal(COLORS[old],COLORS[current]);assert.equal(COLOR_LABELS[old],undefined);
  }
});

test("untrusted identifiers never become paths, colors, URLs or prototype members", () => {
  for (const hostile of ["__proto__","constructor",'\"><script>alert(1)</script>',"url(https://invalid.test)"]) {
    assert.equal(characterLayers(hostile,hostile)[0].attrs.fill,COLORS.blue);
    assert.ok(Object.values(PERSONA_SHAPE_PATHS).includes(characterLayers(hostile,hostile)[0].attrs.d));
    assert.equal(personaShapePath(hostile),PERSONA_SHAPE_PATHS.blob);
  }
});
