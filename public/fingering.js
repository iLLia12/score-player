/*
 * Automatic piano fingering.
 *
 * For each hand, finds the cheapest sequence of finger assignments with dynamic
 * programming. Costs follow Parncutt et al. (1997) "An ergonomic model of keyboard
 * fingering": comfortable / practical spans per finger pair, penalties for stretches,
 * awkward thumb & 5th-finger placement on black keys, weak fingers and hand jumps.
 *
 * Fingers are numbered 1 (thumb) … 5 (little finger) for both hands.
 * Works in the browser (window.PianoFingering) and in Node (module.exports).
 */
(function (root) {
  // Spans start from Parncutt's table; non-thumb maxima are widened slightly (as in
  // Jacobs 2001) since broken-chord figures let the hand rotate between notes.
  // Span table for the right hand, finger a -> finger b (a < b), in semitones:
  // [minPractical, minComfortable, minRelaxed, maxRelaxed, maxComfortable, maxPractical]
  const SPANS = {
    '1-2': [-5, -3, 1, 5, 8, 10],
    '1-3': [-4, -2, 3, 7, 10, 12],
    '1-4': [-3, -1, 5, 9, 12, 14],
    '1-5': [-1, 1, 7, 10, 13, 15],
    '2-3': [1, 1, 1, 2, 4, 6],
    '2-4': [1, 1, 3, 4, 7, 9],
    '2-5': [2, 2, 5, 7, 10, 12],
    '3-4': [1, 1, 1, 2, 3, 5],
    '3-5': [1, 1, 3, 4, 7, 9],
    '4-5': [1, 1, 1, 2, 4, 6],
  };

  const BLACK = new Set([1, 3, 6, 8, 10]);
  const isBlack = (p) => BLACK.has(((p % 12) + 12) % 12);

  /**
   * Cost of moving (or stretching) from finger fa on pitch pa to finger fb on pitch pb.
   * `dir` is +1 for the right hand and -1 for the left hand (mirror image).
   */
  function pairCost(fa, pa, fb, pb, dir) {
    const raw = spanCost(fa, pa, fb, pb, dir);
    const d = (pb - pa) * dir;
    if (Math.abs(d) < 10) return raw;
    // Leap: the hand shifts to a new position instead of stretching, so the cost is
    // capped. The outermost note of the leap (top for RH, bottom for LH) prefers finger 5.
    const outer = d > 0 ? fb : fa;
    return Math.min(raw, 4 + 0.15 * Math.abs(d) + (5 - outer) * 0.4);
  }

  function spanCost(fa, pa, fb, pb, dir) {
    let d = (pb - pa) * dir;
    if (fa === fb) {
      // Same finger: free on a repeated note, otherwise the hand must jump.
      return d === 0 ? 0 : 2.5 + Math.abs(d) * 0.4;
    }
    // Repeated note with a different finger: possible, but unusual outside fast passages.
    const repeatPenalty = d === 0 ? 1.5 : 0;
    let a = fa, b = fb;
    if (a > b) {
      [a, b] = [b, a];
      d = -d;
    }
    if (d < 0) {
      // Crossing: the thumb passes under (or a finger passes over the thumb).
      // Easiest over small intervals and with finger 3; finger 5 practically can't cross.
      if (a !== 1) return 6 + Math.abs(d);
      const base = { 2: 3, 3: 2.5, 4: 3, 5: 8 }[b];
      return base + 0.5 * (Math.abs(d) - 1) + (Math.abs(d) > 5 ? 2 * (Math.abs(d) - 5) : 0);
    }
    const [minP, minC, minR, maxR, maxC, maxP] = SPANS[a + '-' + b];
    let cost = 0;
    // Stretch: beyond the comfortable span.
    if (d > maxC) cost += 2 * (d - maxC);
    if (d < minC) cost += 2 * (minC - d);
    // Way beyond what a hand can reach: needs a position change.
    if (d > maxP) cost += 6 * (d - maxP);
    if (d < minP) cost += 6 * (minP - d);
    // Small span: outside the relaxed range but still comfortable.
    if (d > maxR && d <= maxC) cost += d - maxR;
    if (d < minR && d >= minC) cost += minR - d;
    // 3 and 4 moving together are clumsy.
    if (a === 3 && b === 4) cost += 0.5;
    return cost + repeatPenalty;
  }

  /** Cost of placing a single finger on a pitch, regardless of context. */
  function placeCost(f, p) {
    let c = 0;
    if (isBlack(p)) {
      if (f === 1) c += 1;
      if (f === 5) c += 1;
    }
    if (f === 4) c += 0.25; // weakest finger, prefer others when equal
    return c;
  }

  /** All strictly ordered finger assignments for a chord of k notes (low -> high pitch). */
  const comboCache = {};
  function combos(k, dir) {
    const key = k + ':' + dir;
    if (comboCache[key]) return comboCache[key];
    const out = [];
    const pick = (start, acc) => {
      if (acc.length === k) return out.push(acc.slice());
      for (let f = start; f <= 5; f++) {
        acc.push(f);
        pick(f + 1, acc);
        acc.pop();
      }
    };
    if (k >= 1 && k <= 5) pick(1, []);
    // Right hand: lowest note gets the lowest finger. Left hand: mirrored.
    comboCache[key] = dir > 0 ? out : out.map((c) => c.slice().reverse());
    return comboCache[key];
  }

  /**
   * events: [{ pitches: number[] (ascending), fixed?: (number|null)[], tiedFrom?: boolean[], afterRest?: boolean }]
   * hand: 'right' | 'left'
   * returns: number[][] — fingers per event, aligned with pitches
   */
  function fingerSequence(events, hand) {
    const dir = hand === 'left' ? -1 : 1;
    const n = events.length;
    if (!n) return [];

    // Candidate assignments per event.
    const cands = events.map((ev) => {
      const k = Math.min(ev.pitches.length, 5);
      let list = combos(k, dir);
      if (ev.fixed && ev.fixed.some((f) => f)) {
        const filtered = list.filter((c) => c.every((f, i) => !ev.fixed[i] || ev.fixed[i] === f));
        if (filtered.length) list = filtered;
      }
      return list.map((fingers) => {
        let c = 0;
        for (let i = 0; i < k; i++) c += placeCost(fingers[i], ev.pitches[i]);
        // Internal chord spans.
        for (let i = 0; i + 1 < k; i++) c += 1.5 * pairCost(fingers[i], ev.pitches[i], fingers[i + 1], ev.pitches[i + 1], dir);
        // Wide chords (a 5th or more) are normally spanned with finger 5 on the outer note.
        if (k >= 2 && ev.pitches[k - 1] - ev.pitches[0] >= 7) {
          const outerFinger = dir > 0 ? fingers[k - 1] : fingers[0];
          c += (5 - outerFinger) * 0.3;
        }
        return { fingers, cost: c };
      });
    });

    function transition(prevEv, prev, ev, cur) {
      const pa = prevEv.pitches, pb = ev.pitches;
      let c = 0;
      // Tied notes must keep their finger.
      if (ev.tiedFrom) {
        for (let i = 0; i < pb.length; i++) {
          if (!ev.tiedFrom[i]) continue;
          const j = pa.indexOf(pb[i]);
          if (j >= 0 && prev.fingers[j] !== cur.fingers[i]) c += 50;
        }
      }
      // Melodic motion: compare outer voices (top and bottom).
      const outer = (len) => (len === 1 ? [0] : [0, len - 1]);
      const oa = outer(Math.min(pa.length, 5)), ob = outer(Math.min(pb.length, 5));
      let m = 0;
      for (let i = 0; i < ob.length; i++) {
        const ia = oa[Math.min(i, oa.length - 1)], ib = ob[i];
        m += pairCost(prev.fingers[ia], pa[ia], cur.fingers[ib], pb[ib], dir);
      }
      m /= ob.length;
      // Thumb on a black key right after/before a white key is extra awkward.
      for (let i = 0; i < ob.length; i++) {
        const ib = ob[i];
        if (cur.fingers[ib] === 1 && isBlack(pb[ib]) && !isBlack(pa[oa[0]]) && Math.abs(pb[ib] - pa[oa[0]]) < 10) m += 1;
      }
      // After a rest the hand can freely reposition.
      return c + (ev.afterRest ? m * 0.25 : m);
    }

    // Viterbi.
    let cost = cands[0].map((c) => c.cost);
    const back = [cands[0].map(() => -1)];
    for (let t = 1; t < n; t++) {
      const nextCost = [];
      const nextBack = [];
      for (let j = 0; j < cands[t].length; j++) {
        let best = Infinity, arg = 0;
        for (let i = 0; i < cands[t - 1].length; i++) {
          const v = cost[i] + transition(events[t - 1], cands[t - 1][i], events[t], cands[t][j]);
          if (v < best) { best = v; arg = i; }
        }
        nextCost.push(best + cands[t][j].cost);
        nextBack.push(arg);
      }
      cost = nextCost;
      back.push(nextBack);
    }
    let idx = cost.indexOf(Math.min(...cost));
    const out = new Array(n);
    for (let t = n - 1; t >= 0; t--) {
      out[t] = cands[t][idx].fingers;
      idx = back[t][idx];
    }
    // Chords with more than 5 notes: leave extra notes unfingered.
    return out.map((f, t) => events[t].pitches.map((_, i) => (i < f.length ? f[i] : null)));
  }

  // ---------- alphaTab integration ----------

  /** Which hand plays this staff: bass clef -> left, otherwise right. */
  function handForStaff(staff, staffIndex, staffCount) {
    const clef = staff.bars.length ? staff.bars[0].clef : 4;
    // alphaTab Clef enum: Neutral=0, C3=1, C4=2, F4=3, G2=4
    if (clef === 3) return 'left';
    if (clef === 4) return 'right';
    return staffCount > 1 && staffIndex === staffCount - 1 ? 'left' : 'right';
  }

  /**
   * Computes fingering for every note in the score.
   * Returns a Map<Note, finger 1..5>. Existing fingering in the file is respected.
   */
  function computeScoreFingering(score, fingerOf) {
    const result = new Map();
    for (const track of score.tracks) {
      // Piano-style fingering only makes sense for keyboard-like parts (no drums, no strings).
      if (track.staves.some((s) => s.isPercussion || s.isStringed)) continue;
      track.staves.forEach((staff, si) => {
        const hand = handForStaff(staff, si, track.staves.length);
        // Only the first voice is used for the melodic line; other voices are fingered on their own.
        const voiceCount = Math.max(...staff.bars.map((b) => b.voices.length));
        for (let v = 0; v < voiceCount; v++) {
          const events = [];
          const noteRefs = [];
          let restPending = false;
          for (const bar of staff.bars) {
            const voice = bar.voices[v];
            if (!voice || voice.isEmpty) { restPending = true; continue; }
            for (const beat of voice.beats) {
              const notes = beat.notes.filter((n) => !n.isDead && n.realValue >= 0);
              if (beat.isRest || !notes.length) { restPending = true; continue; }
              notes.sort((a, b) => a.realValue - b.realValue);
              events.push({
                pitches: notes.map((n) => n.realValue),
                fixed: notes.map((n) => fingerOf(n)),
                tiedFrom: notes.map((n) => n.isTieDestination),
                afterRest: restPending,
              });
              noteRefs.push(notes);
              restPending = false;
            }
          }
          const fingers = fingerSequence(events, hand);
          fingers.forEach((fs, t) => fs.forEach((f, i) => f && result.set(noteRefs[t][i], { finger: f, hand })));
        }
      });
    }
    return result;
  }

  const api = { fingerSequence, computeScoreFingering, pairCost };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PianoFingering = api;
})(typeof window !== 'undefined' ? window : globalThis);
