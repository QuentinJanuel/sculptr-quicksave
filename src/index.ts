import { createMod, gameMakerKey, type Mod, type Ref, type UiTone } from "@sculptr/sdk";
import { findSaveModel, type SaveModel } from "@sculptr/detect";
import { text, type Text } from "./i18n";
import saveBlock from "./sprites/save.png?inline";

const ANCHOR_TOLERANCE = 8;

/**
 * A move this big in one step is the game placing the player, not the player walking. Generous on
 * purpose: a respawn nearly always rebuilds the player too, which the identity test catches on its
 * own, so this only has to cover the rarer teleport that keeps the same instance.
 */
const RESPAWN_JUMP = 64;

/**
 * Frames to keep checking the room after a quicksave is applied. Acting the moment a respawn is
 * seen is what stops the player being drawn on the save first, but a room change the game asked for
 * this frame has not landed yet. A `room_goto` of our own overrides it -- last call in the frame
 * wins -- so the only gap left is the one where we had no reason to make that call, already being
 * in the quicksave's room.
 */
const SETTLE_FRAMES = 3;

/**
 * What the panel is showing, as one number the game keeps up to date.
 *
 * The mod already reports every *transition* -- placed, cancelled, restored -- but a panel has to
 * show a *state*, including the state it was already in when you opened it. So the object works out
 * which of these it is each step and sends it only when it changes: a handful of messages per run
 * rather than one per frame, and the panel is never stale.
 */
const STATUS = {
  waiting: 0,
  ready: 1,
  airborne: 2,
  placed: 3,
  cancelled: 4,
} as const;

/**
 * How each status reads to a player, and how loudly.
 *
 * The word itself is in `i18n.ts`, under the name kept here: it is the only part that changes with
 * the player's language, and how loud a status is does not depend on which language says it.
 */
const STATUS_LOOK: Record<number, { key: keyof Text["status"]; tone: UiTone }> = {
  [STATUS.waiting]: { key: "waiting", tone: "muted" },
  [STATUS.ready]: { key: "ready", tone: "ok" },
  [STATUS.airborne]: { key: "airborne", tone: "warning" },
  [STATUS.placed]: { key: "placed", tone: "ok" },
  [STATUS.cancelled]: { key: "cancelled", tone: "muted" },
};

const MARKER = {
  scale: 0.85,
  alpha: 0.6,
  /** Degrees either side of upright, and milliseconds per radian. */
  swing: 8,
  pace: 800,
};

/** The globals this mod keeps its state in. Plain names: hooks run inside the game's own code. */
const G = {
  state: "global.quicksave_state", // 0 none, 1 placed, 2 cancelled (X off until the next respawn)
  room: "global.quicksave_room",
  x: "global.quicksave_x",
  y: "global.quicksave_y",
  markerX: "global.quicksave_marker_x",
  markerY: "global.quicksave_marker_y",
  hasAnchor: "global.quicksave_has_anchor",
  /** The room the anchor is in, or -1 while that is not known yet. See `atAnchor`. */
  anchorRoom: "global.quicksave_anchor_room",
  anchorX: "global.quicksave_anchor_x",
  anchorY: "global.quicksave_anchor_y",
  applying: "global.quicksave_applying",
  carried: (index: number) => `global.quicksave_carried${index}`,
};

const install = function (
  mod: Mod,
  model: SaveModel,
  keys: { place: Ref<string>; remove: Ref<string> },
  status: Ref<number>,
  placedAt: Ref<string>,
  onKeysChanged: (handler: () => void) => void,
): void {
  const { players, carried, createReads, positionWrites, loads } = model;
  const file = mod.scratchPath("state.txt");
  const block = mod.resource.sprite.create("save", { origin: { x: 16, y: 16 } });
  void block.load([saveBlock]);

  // The *newest* instance: a load that destroys the player and makes a new one leaves both alive for
  // the rest of the step, and `with` skips only the destroyed one.
  mod.resource.script.create({
    name: "player",
    body: () => `global.quicksave_found = noone;
${players
  .map(
    (p) => `with (${p}) {
  if (global.quicksave_found == noone || id > global.quicksave_found) global.quicksave_found = id;
}`,
  )
  .join("\n")}
return global.quicksave_found;`,
  });

  // Either way up, so upside-down gravity still counts as standing.
  mod.resource.script.create({
    name: "grounded",
    args: ["who"],
    body: ({ a }) => `global.quicksave_grounded = 0;
with (${a.who}) {
  if (vspeed == 0 && (!place_free(x, y + 1) || !place_free(x, y - 1))) global.quicksave_grounded = 1;
};
return global.quicksave_grounded;`,
  });

  // A scratch file, because `game_restart()` wipes every global and some games restart on every
  // death. Read back in this object's Create, which runs before any of the game's own code.
  const writeValue = (name: string) => `if (is_string(${name})) {
  file_text_write_string(qs_file, "s"); file_text_writeln(qs_file); file_text_write_string(qs_file, ${name});
} else {
  file_text_write_string(qs_file, "r"); file_text_writeln(qs_file); file_text_write_real(qs_file, ${name});
}
file_text_writeln(qs_file);`;
  const readValue = (name: string) => `qs_kind = file_text_read_string(qs_file); file_text_readln(qs_file);
if (qs_kind == "s") ${name} = file_text_read_string(qs_file); else ${name} = file_text_read_real(qs_file);
file_text_readln(qs_file);`;
  const reals = [
    G.state,
    G.room,
    G.x,
    G.y,
    G.markerX,
    G.markerY,
    G.hasAnchor,
    G.anchorRoom,
    G.anchorX,
    G.anchorY,
  ];

  mod.resource.script.create({
    name: "persist",
    body: () => `var qs_file;
if (${G.state} == 0) {
  if (file_exists(${file})) file_delete(${file});
  exit;
}
qs_file = file_text_open_write(${file});
${reals.map((name) => `file_text_write_real(qs_file, ${name}); file_text_writeln(qs_file);`).join("\n")}
${carried.map((_, index) => writeValue(G.carried(index))).join("\n")}
file_text_close(qs_file);`,
  });

  mod.resource.script.create({
    name: "reset",
    body: () => `${[...reals, G.applying, ...carried.map((_, index) => G.carried(index))].map((name) => `${name} = 0;`).join("\n")}
${G.anchorRoom} = -1;`,
  });

  mod.resource.script.create({
    name: "restore",
    body: ({ call }) => `var qs_file, qs_kind;
${call("reset")};
if (!file_exists(${file})) exit;
qs_file = file_text_open_read(${file});
${reals.map((name) => `${name} = file_text_read_real(qs_file); file_text_readln(qs_file);`).join("\n")}
${carried.map((_, index) => readValue(G.carried(index))).join("\n")}
file_text_close(qs_file);`,
  });

  /**
   * Is this player standing where the game's own save would put them? `checkRoom` is off for a
   * caller that cannot answer that honestly: inside a load the game has queued a room change that
   * has not happened, so the room it is running in is the one being left, not the anchor's.
   */
  mod.resource.script.create({
    name: "atAnchor",
    args: ["who", "checkRoom"],
    body: ({ a }) => `if (!${G.hasAnchor}) return 0;
if (${a.checkRoom} && ${G.anchorRoom} >= 0 && ${G.anchorRoom} != room) return 0;
if (abs(${a.who}.x - ${G.anchorX}) > ${ANCHOR_TOLERANCE}) return 0;
if (abs(${a.who}.y - ${G.anchorY}) > ${ANCHOR_TOLERANCE}) return 0;
return 1;`,
  });

  // A player built while one of these differed has to be built again; only its Create can match it.
  const rebuildIf = createReads
    .map((name) => `if (global.${name} != ${G.carried(carried.indexOf(name))}) qs_rebuild = 1;`)
    .join("\n");

  /**
   * Put this player on the quicksave. `inPlace` for a respawn that asked for no room of its own: a
   * load has already picked one and has to be overridden, while going to the room we are already in
   * would restart it.
   */
  mod.resource.script.create({
    name: "apply",
    args: ["who", "inPlace"],
    body: ({ a }) => `var qs_rebuild;
${G.applying} = 1;
qs_rebuild = 0;
${rebuildIf}
${carried.map((name, index) => `global.${name} = ${G.carried(index)};`).join("\n")}
if (${a.inPlace} == 0 || room != ${G.room}) room_goto(${G.room});
with (${a.who}) {
  if (qs_rebuild) event_perform(ev_create, 0);
  x = ${G.x};
  y = ${G.y};
  xprevious = x;
  yprevious = y;
  hspeed = 0;
  vspeed = 0;
}
${G.applying} = 0;`,
  });

  // Usually several lines per save -- x and y separately, or one per gravity branch -- so this runs
  // more than once per save. Harmless: it sets the anchor twice and clears a quicksave already gone.
  // A save routine runs in the room it is saving, so unlike a load this anchor knows its room.
  for (const write of positionWrites) {
    mod.resource.script.insert({
      at: write,
      place: "after",
      body: ({ call, send }) => `
        var qs_player;
        if (!${G.applying}) {
          qs_player = ${call("player")};
          if (qs_player != noone) {
            ${G.anchorX} = qs_player.x;
            ${G.anchorY} = qs_player.y;
            ${G.anchorRoom} = room;
            ${G.hasAnchor} = 1;
          }
          if (${G.state} != 0) {
            ${G.state} = 0;
            ${send("cleared", `"a real save"`)}
          }
          ${call("persist")};
        }
      `,
    });
  }

  // A load that misses the anchor is not evidence the quicksave is stale, and nothing is thrown
  // away for it: a game may run its load routine more than once for one reload and pass through
  // somewhere else on the way. Only a real save or C retires a quicksave.
  for (const load of loads) {
    mod.resource.script.hook(load, ({ original, call, send }) => `
        var qs_result, qs_player;
        qs_result = ${original.call()};
        qs_player = ${call("player")};
        if (qs_player != noone) {
          if (${G.state} == 1 && ${call("atAnchor", "qs_player", "0")}) {
            ${call("apply", "qs_player", "0")};
            ${send("restored", `"by ${load}"`)}
          } else if (${G.state} == 1) {
            ${send("missed", `"a load landed away from this quicksave's save"`)}
          } else {
            if (${G.state} == 2) ${send("rearmed", `"by ${load}"`)}
            ${G.state} = 0;
            ${G.anchorX} = qs_player.x;
            ${G.anchorY} = qs_player.y;
            ${G.anchorRoom} = -1;
            ${G.hasAnchor} = 1;
          }
          ${call("persist")};
        }
        return qs_result;
      `);
  }

  mod.resource.object.create({
    name: "quicksave",
    vars: [
      "standing",
      "who",
      "seen",
      "settle",
      "lastId",
      "lastX",
      "lastY",
      "lastRoom",
      // The two rebindable keys, and the last status reported. Variables rather than literals: the
      // GML is written before the player has said which keys they want, so the keys have to be able
      // to arrive afterwards. See `gameMakerKey` in the SDK.
      "keyPlace",
      "keyRemove",
      "status",
    ],
    events: {
      // `send("ready")` is the important line. The keys below are the *defaults*, and they have to
      // be: baking the player's choice in would make the GML depend on a setting, so changing a
      // keybind would re-patch an installed game. So the object asks instead -- and asks on every
      // Create, which is what makes this survive `game_restart()`. These games restart on death, and
      // a restart rebuilds this object with the defaults back in it; a one-shot push at launch was
      // corrected once and then quietly undone by the first death.
      create: ({ v, call, send }) => `
        ${call("restore")};
        ${v.standing} = 0;
        ${v.seen} = 0;
        ${v.settle} = 0;
        ${v.lastId} = noone;
        ${v.lastX} = 0;
        ${v.lastY} = 0;
        ${v.lastRoom} = -1;
        ${v.keyPlace} = ${gameMakerKey("KeyX")};
        ${v.keyRemove} = ${gameMakerKey("KeyC")};
        ${v.status} = -1;
        ${send("ready")}
      `,
      // `depth` one behind the player, the only depth that means the same thing in every game.
      // `standing` counts two steps, so bumping a ceiling mid-jump is not standing on it.
      step: ({ v, call, send }) => `
        var qs_status;
        ${v.who} = ${call("player")};
        if (${v.who} != noone) depth = ${v.who}.depth + 1;
        if (${v.who} != noone && ${call("grounded", v.who)}) ${v.standing} += 1;
        else ${v.standing} = 0;

        if (${v.keyPlace} > 0 && keyboard_check_pressed(${v.keyPlace})) {
          if (${G.state} != 0) {
            ${send("refused", `"a quicksave is already placed, or was cancelled until the next respawn"`)}
          } else if (!${G.hasAnchor}) {
            ${send("refused", `"the game has not saved or loaded yet"`)}
          } else if (${v.standing} < 2) {
            ${send("refused", `"not standing on anything"`)}
          } else {
            ${G.room} = room;
            ${G.x} = ${v.who}.x;
            ${G.y} = ${v.who}.y;
            ${G.markerX} = (${v.who}.bbox_left + ${v.who}.bbox_right) / 2;
            ${G.markerY} = (${v.who}.bbox_top + ${v.who}.bbox_bottom) / 2;
            ${carried.map((name, index) => `${G.carried(index)} = global.${name};`).join("\n          ")}
            ${G.state} = 1;
            ${call("persist")};
            ${send("placed", `room_get_name(room) + " " + string(${G.x}) + "," + string(${G.y})`)}
          }
        }

        if (${v.keyRemove} > 0 && keyboard_check_pressed(${v.keyRemove}) && ${G.state} == 1) {
          ${G.state} = 2;
          ${call("persist")};
          ${send("cancelled")}
        }

        // Sent only when it changes, which is a few times a run rather than once a frame. This is
        // the whole of what the panel shows, so it is worked out here where every input to it --
        // the anchor, the state, whether the player is standing -- is already in hand.
        if (${G.state} == 1) qs_status = ${STATUS.placed};
        else if (${G.state} == 2) qs_status = ${STATUS.cancelled};
        else if (!${G.hasAnchor}) qs_status = ${STATUS.waiting};
        else if (${v.standing} < 2) qs_status = ${STATUS.airborne};
        else qs_status = ${STATUS.ready};
        if (qs_status != ${v.status}) {
          ${v.status} = qs_status;
          ${send("status", "string(qs_status)")}
        }
      `,
      // Watching what happened, not how: a game can put its player back without ever calling the
      // routine that loads its save -- from a pair of globals, by restarting the room, by moving one
      // that never died -- and a hook on that routine sees none of it. What every respawn shares is
      // the outcome, a player arriving discontinuously on the last real save. End Step runs after
      // the frame's movement and before Draw, so the position is final and nothing is drawn yet.
      //
      // Acting cannot set this off again: afterwards the player is on the quicksave, which is either
      // nowhere near the anchor or caught by `qs_here`. A cancelled quicksave is rearmed here for the
      // same reason it is rearmed in the load hook -- a respawn is what ends the cancellation.
      endStep: ({ v, call, send }) => `
        var qs_who, qs_jump, qs_here;
        qs_who = ${call("player")};

        if (qs_who != noone && ${G.hasAnchor} && ${G.anchorRoom} < 0) {
          if (${call("atAnchor", "qs_who", "0")}) ${G.anchorRoom} = room;
        }

        qs_jump = 0;
        if (qs_who == noone) {
          ${v.seen} = 0;
        } else if (!${v.seen}) {
          qs_jump = 1;
        } else if (qs_who != ${v.lastId} || room != ${v.lastRoom}) {
          qs_jump = 1;
        } else if (abs(qs_who.x - ${v.lastX}) > ${RESPAWN_JUMP}
                || abs(qs_who.y - ${v.lastY}) > ${RESPAWN_JUMP}) {
          qs_jump = 1;
        }

        if (qs_who != noone) {
          if (${v.settle} > 0) {
            ${v.settle} -= 1;
            if (${G.state} == 1 && room != ${G.room}) {
              ${call("apply", "qs_who", "0")};
              ${call("persist")};
            }
          }

          if (qs_jump && ${G.state} != 0) {
            if (${call("atAnchor", "qs_who", "1")}) {
              qs_here = 0;
              if (${G.state} == 1) {
                qs_here = (room == ${G.room}
                  && abs(qs_who.x - ${G.x}) <= ${ANCHOR_TOLERANCE}
                  && abs(qs_who.y - ${G.y}) <= ${ANCHOR_TOLERANCE});
              }
              if (!qs_here) {
                if (${G.state} == 1) {
                  ${call("apply", "qs_who", "1")};
                  ${send("restored", `"after a respawn"`)}
                  ${call("persist")};
                  ${v.settle} = ${SETTLE_FRAMES};
                } else if (${G.state} == 2) {
                  ${G.state} = 0;
                  ${call("persist")};
                  ${send("rearmed", `"after a respawn"`)}
                }
              }
            }
          }
          ${v.seen} = 1;
          ${v.lastId} = qs_who;
          ${v.lastX} = qs_who.x;
          ${v.lastY} = qs_who.y;
          ${v.lastRoom} = room;
        }
      `,
      draw: () => `
        if (${G.state} == 1 && room == ${G.room} && ${block.id} >= 0) {
          draw_sprite_ext(${block.id}, 0, ${G.markerX}, ${G.markerY}, ${MARKER.scale}, ${MARKER.scale},
            ${MARKER.swing} * sin(current_time / ${MARKER.pace}), c_white, ${MARKER.alpha});
        }
      `,
    },
    receive: {
      // A file still there on a new launch is from a run that ended without clearing it.
      fresh: ({ call }) => `
        ${call("reset")};
        ${call("persist")};
      `,
      // The player rebound a key. Applies on the very next frame; nothing is rebuilt.
      keyPlace: ({ v, payload }) => `${v.keyPlace} = real(${payload});`,
      keyRemove: ({ v, payload }) => `${v.keyRemove} = real(${payload});`,
    },
  });

  const pushKeys = (): void => {
    mod.send("keyPlace", String(gameMakerKey(keys.place.value)));
    mod.send("keyRemove", String(gameMakerKey(keys.remove.value)));
  };

  // Once per launch: a file left behind by a run that ended badly is not a quicksave to restore.
  mod.onStart(() => mod.send("fresh"));
  // Every time the object is built, which is once per launch *and* once per `game_restart()`. The
  // game asks; this answers. Nothing here has to know when a restart happened.
  mod.on("ready", pushKeys);
  onKeysChanged(pushKeys);

  mod.on("status", (value) => {
    status.value = Number(value);
  });
  // Where it is, for the panel to show. Only "placed" carries a location; everything else that ends
  // a quicksave clears it, so the panel never names somewhere the marker no longer is.
  mod.on("placed", (where) => {
    placedAt.value = where;
  });
  for (const event of ["cancelled", "restored", "cleared", "rearmed"]) {
    mod.on(event, () => {
      placedAt.value = "";
    });
  }

  for (const event of ["placed", "cancelled", "restored", "rearmed", "cleared", "missed", "refused"]) {
    mod.on(event, (payload) => console.log(`[quicksave] ${event}${payload ? `: ${payload}` : ""}`));
  }
}

export default createMod((mod) => {
  // Declared before the game is looked at, so the keys are on screen -- and rebindable -- even in a
  // game this mod cannot work in. A control that disappears when something goes wrong is a control
  // the player cannot use to find out what.
  const keys = {
    place: mod.ui.state("KeyX", { persist: "placeKey" }),
    remove: mod.ui.state("KeyC", { persist: "removeKey" }),
  };
  const status = mod.ui.state<number>(STATUS.waiting);
  const placedAt = mod.ui.state("");
  const supported = mod.ui.state(true);

  // Which language to read the panel in. A state rather than a plain value because the player can
  // change it in the host while the game runs: `getPlayer()` is pinned for as long as this function
  // is running -- which is what stops a mod declaring one thing in the renderer and another in the
  // main process -- so the live value arrives through `onPlayerChange` instead, and the panel follows
  // because every label below is bound to a function that reads this.
  const language = mod.ui.state(mod.getPlayer().language);
  mod.onPlayerChange((player) => {
    language.value = player.language;
  });
  /** The panel's words, now. Called per label rather than hoisted, so a change re-reads it. */
  const t = (): Text => text(language.value);

  const current = () => {
    const look = STATUS_LOOK[status.value] ?? STATUS_LOOK[STATUS.waiting]!;
    return { label: t().status[look.key], tone: look.tone };
  };

  // The title is the mod's name, which is why it is the one string here that is not translated: the
  // catalog lists it in English whatever the page is in, and `panel` takes a plain string, so it
  // could not follow a language change even if it wanted to.
  mod.ui.panel({ title: "Quicksave" }, (ui) => [
    ui.section({}, [
      ui.dynamic(() =>
        supported.value
          ? [ui.badge(current().label, { tone: current().tone })]
          : [ui.badge(t().unsupported, { tone: "danger" })],
      ),
    ]),
    ui.section({ title: () => t().controls }, [
      ui.keybind({ label: () => t().place, value: keys.place, onChange: () => onKeys() }),
      ui.keybind({ label: () => t().remove, value: keys.remove, onChange: () => onKeys() }),
    ]),
  ]);

  // `install` owns the channel to the game, so it hands back the one thing this side needs: a way
  // to say the keys moved. Null until then, which is also the "unsupported game" case -- there is
  // nothing listening, and a rebind is simply remembered for the next game that is.
  let onKeys: () => void = () => {};

  const model = findSaveModel(mod.content);
  if (!model.ok) {
    supported.value = false;
    console.warn(`[quicksave] this game is not supported: ${model.error}`);
    return;
  }
  install(mod, model.value, keys, status, placedAt, (handler) => (onKeys = handler));
})
