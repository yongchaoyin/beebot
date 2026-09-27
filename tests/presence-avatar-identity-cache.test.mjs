import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { parse } from "acorn";
import { patchOriginalLanding } from "../scripts/lib/router-renderer-patch.mjs";
import { patchPresenceAvatarCache } from "../scripts/lib/presence-avatar-cache-patch.mjs";
import { AVATAR_PALETTE } from "../frontend/src/presence/avatar-art.ts";
import { avatarExpressionFromAgent } from "../frontend/src/presence/avatar-expression.ts";

const original = await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js", import.meta.url), "utf8");
const patched = patchOriginalLanding(original);
function declarations(source) {
  const functions = new Map(), constants = new Map();
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if (node.type === "FunctionDeclaration") functions.set(node.id.name, source.slice(node.start, node.end));
    if (node.type === "VariableDeclaration") for (const part of node.declarations) {
      if (part.id.type === "Identifier") constants.set(part.id.name, { text: source.slice(part.start, part.end), node: part.init });
    }
  }
  return { functions, constants };
}
const upstream = declarations(original), shipped = declarations(patched);
const pickFunctions = (from, names) => names.map(name => {
  assert.ok(from.functions.has(name), `pinned function ${name}`);
  return from.functions.get(name);
}).join("\n");
const pickConstants = (from, names) => names.map(name => {
  assert.ok(from.constants.has(name), `pinned constant ${name}`);
  return `const ${from.constants.get(name).text};`;
}).join("\n");
function codec(from = shipped) {
  return new Function(`${pickConstants(from, ["oKe", "QUn", "eHn", "aKe", "GUn", "WUn", "KUn"])}
    ${pickFunctions(from, ["Y0t", "Ppe", "Mpe", "lKe", "tHn", "nHn", "sHn", "rHn", "YUn", "ZUn", "XUn"])}
    return { encode: Y0t, decode: tHn, create: rHn, photos: XUn };`)();
}
const cache = codec();
function registry() {
  const disk = new Map(), classifications = [];
  return {
    disk, classifications,
    register(descriptor) {
      const key = account => `${account}:${descriptor.slice}`;
      return {
        async write({ accountSlot, value }) {
          disk.set(key(accountSlot), JSON.stringify({ schemaVersion: descriptor.schemaVersion, value }));
        },
        async read(account) {
          const bytes = disk.get(key(account));
          return bytes == null ? { kind: "absent" } : {
            kind: "envelope", envelope: JSON.parse(bytes),
            receipt: { classify: result => classifications.push(result) },
          };
        },
        async clear(account) { disk.delete(key(account)); },
      };
    },
  };
}
function agent(id, avatarColor = "green", avatarShape = "cloud", extra = {}) {
  return {
    id, name: "Same display name", description: "Synthetic colleague", title: "Test",
    avatarShape, avatarColor, avatarVersion: null, avatarDataUrl: null,
    createdAt: 1, updatedAt: 2, path: `/synthetic/${id}`, lastEntry: null,
    lastMessageId: null, hasUnread: false, awaitingUserResponse: null,
    notificationsEnabled: true, notifyOnUpdatesEnabled: false, origin: "local",
    isGroup: false, memberIds: [], conversationPartnerIds: [], ...extra,
  };
}
const identities = [agent("a", "green", "cloud"), agent("b", "green", "blob"), agent("c", "blue", "tablet"), agent("d", "violet", "squircle")];
const identity = row => ({ id: row.id, color: row.avatarColor, shape: row.avatarShape });
async function persist(rows, state = registry()) {
  const writer = cache.create({ registry: state });
  await writer.restore("fixture-account");
  writer.write(rows);
  await setImmediate(); // Flush the real codec's coalesced write promise.
  writer.dispose();
  const reader = cache.create({ registry: state });
  const restored = await reader.restore("fixture-account");
  reader.dispose();
  return { state, restored };
}

// Execute actual pinned UI projections. JSX/hooks are a descriptor-only shim;
// collage SVG encoding is stubbed so its real selected identity can be inspected.
const allowedShapes = upstream.constants.get("Jo").node.properties.map(property => property.key.name);
const ui = new Function("RPresenceUI", `
  ${pickConstants(upstream, ["Ij", "aOt", "Z9e", "Jj", "eZ"])}
  const PQ=RPresenceUI.avatarPalette, nnt=PQ.filter(n=>n.id!=="black"), Qtt=${JSON.stringify(allowedShapes)};
  const he={c:size=>Array(size).fill(Symbol.for("react.memo_cache_sentinel"))};
  const p={jsx:(type,props)=>({type:typeof type==="function"?type.name:type,props})};
  const S={useId:()=>"fixture-avatar"}, VZ=()=>({resolved:"light"}), sd="sd", au="au";
  const _Ne=(id,options)=>JSON.stringify({id,...options});
  ${pickFunctions(shipped, ["mOt", "u4e", "lOt", "cnt", "oOt", "unt", "uOt", "sle", "Eee", "Cee", "pct", "gct", "wbe", "kct", "Iee", "ml", "pln", "vct"])}
  return { list: ml, dispatch: Iee, members: pln, collage: vct, color: Cee, shape: Eee };
`)({ avatarPalette: AVATAR_PALETTE, avatarExpressionFromAgent });

test("actual shipped roster writer fixes the upstream loss without changing the pinned baseline", () => {
  const prior = codec(upstream).encode(identities[0]);
  assert.equal(Object.hasOwn(prior, "avatarColor"), false, "regression witness: upstream writer dropped color");
  assert.equal(Object.hasOwn(prior, "avatarShape"), false, "regression witness: upstream writer dropped shape");
  for (const row of identities) assert.deepEqual(identity(cache.decode(JSON.parse(JSON.stringify(cache.encode(row))))), identity(row));
  assert.equal(shipped.functions.get("tHn"), upstream.functions.get("tHn"), "restore validation and activity stripping stay unchanged");
});

test("a fresh pinned roster store restores the four profile identities without stale working state", async () => {
  const live = identities.map(row => ({ ...row, isRunning: true, isActive: true, isComposingMessage: true, currentActivity: { kind: "tool", tool: "Read" }, snapshotEpoch: "old", snapshotSeq: 20 }));
  const { restored, state } = await persist(live);
  assert.deepEqual(restored.map(identity), identities.map(identity));
  assert.ok(restored.every(row => row.isRunning === false && row.isActive === false && row.isComposingMessage === false));
  assert.ok(restored.every(row => !Object.hasOwn(row, "currentActivity") && !Object.hasOwn(row, "snapshotEpoch")));
  assert.equal(JSON.parse(state.disk.get("fixture-account:roster.last-roster")).schemaVersion, 2);
});

test("explicit avatar edits, nulls and empty resets replace earlier identity instead of sticking", async () => {
  const first = await persist(identities);
  const edited = identities.map((row, index) => ({ ...row, updatedAt: 3, avatarShape: ["hex", null, "", "teardrop"][index], avatarColor: ["red", null, "", "cyan"][index] }));
  const { restored } = await persist(edited, first.state);
  assert.deepEqual(restored.map(identity), edited.map(identity));
  for (const row of restored) {
    const live = edited.find(item => item.id === row.id);
    assert.equal(ui.color(row), ui.color(live));
    assert.equal(ui.shape(row), ui.shape(live));
  }
});

test("old schema-2 rows remain readable and a real subsequent online write fills identity", async () => {
  const state = registry();
  state.disk.set("fixture-account:roster.last-roster", JSON.stringify({ schemaVersion: 2, value: { rows: identities.map(codec(upstream).encode) } }));
  const reader = cache.create({ registry: state });
  const legacy = await reader.restore("fixture-account");
  assert.equal(legacy.length, 4);
  assert.ok(legacy.every(row => !Object.hasOwn(row, "avatarColor") && !Object.hasOwn(row, "avatarShape")));
  reader.dispose();
  const { restored } = await persist(identities, state);
  assert.deepEqual(restored.map(identity), identities.map(identity));
  const otherAccount = cache.create({ registry: state });
  assert.equal(await otherAccount.restore("other-account"), null);
  otherAccount.dispose();
});

test("single-Bot list and Group member/collage projections keep their online identities after restore", async () => {
  const { restored } = await persist(identities);
  for (let index = 0; index < identities.length; index++) {
    const live = ui.list({ agent: identities[index] });
    const offline = ui.list({ agent: restored[index] });
    assert.deepEqual(offline, live);
    const face = ui.dispatch(offline.props);
    assert.equal(face.props.color, identities[index].avatarColor);
    assert.equal(face.props.shape, identities[index].avatarShape);
    assert.equal(face.props.avatarIdentity, `sand-agent-mark-source-${identities[index].id}`);
    const working = ui.list({ agent: { ...restored[index], isRunning: true }, isStatic: false });
    assert.equal(working.props.color, live.props.color);
    assert.equal(working.props.shape, live.props.shape);
  }
  const group = { memberIds: identities.map(row => row.id) };
  const onlineMembers = ui.members(group, identities, [], null);
  const restoredMembers = ui.members(group, restored, [], null);
  assert.deepEqual(restoredMembers, onlineMembers);
  assert.deepEqual(restoredMembers.map(ui.collage), onlineMembers.map(ui.collage));
});

test("photo bytes stay in the separate versioned cache and the real avatar dispatcher keeps photos", async () => {
  const photo = "data:image/png;base64,c3ludGhldGlj";
  const row = agent("photo", "blue", "hex", { avatarVersion: "photo-version-1", avatarDataUrl: photo });
  const { state, restored } = await persist([row]);
  assert.equal(restored[0].avatarVersion, row.avatarVersion);
  assert.equal(restored[0].avatarDataUrl, null);
  assert.ok(!state.disk.get("fixture-account:roster.last-roster").includes(photo));
  const photos = cache.photos({ registry: state });
  await photos.restore("fixture-account");
  photos.remember(row.id, { version: row.avatarVersion, dataUrl: photo });
  await setImmediate();
  photos.dispose();
  const freshPhotos = cache.photos({ registry: state });
  await freshPhotos.restore("fixture-account");
  const savedPhoto = freshPhotos.get(row.id);
  assert.deepEqual(savedPhoto, { version: row.avatarVersion, dataUrl: photo });
  const descriptor = ui.dispatch(ui.list({ agent: { ...restored[0], avatarDataUrl: savedPhoto.dataUrl } }).props);
  assert.equal(descriptor.type, "au");
  assert.equal(descriptor.props.src, photo);
  freshPhotos.dispose();
  assert.equal(shipped.functions.get("XUn"), upstream.functions.get("XUn"));
});

test("the identity writer patch rejects upstream drift, duplicate anchors and repeat application", () => {
  assert.throws(() => patchPresenceAvatarCache(original.replace("title:n.title,avatarVersion:n.avatarVersion", "title:n.title,avatarVersion:null")), /differs from the pinned/);
  assert.throws(() => patchPresenceAvatarCache(original + upstream.functions.get("Y0t")), /differs from the pinned/);
  assert.throws(() => patchPresenceAvatarCache(patchPresenceAvatarCache(original)), /differs from the pinned/);
});
