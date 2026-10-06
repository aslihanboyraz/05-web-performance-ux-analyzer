(function () {
  "use strict";

  var FIELDS = ["field-name", "field-email", "field-feedback", "field-search"];
  var SCENARIOS = {
    sade: "Sade sayfa açık. Yazım ve tıklama ölçülür; ek yük yoktur.",
    urun: "Ürün vitrini. Arama yazım hızına, sepete ekleme tıklama günlüğüne girer.",
    agir: "Ağır katalog. Yüzlerce düğüm ve derin bir ağaç eklenir; DOM satırı yükselir.",
    kayma: "Kaymalı yerleşim. Düğmeden 0,7 sn sonra bant açılır ve CLS artar.",
    yavas: "Yavaş işlem. Düğme ana iş parçacığını yaklaşık 320 ms kilitler."
  };
  var LOG_LIMIT = 40;
  var HEAT_RADIUS = 22;

  var state = {
    lcp: null,
    fcp: null,
    inp: null,
    cls: 0,
    nav: null,
    scenario: "sade",
    longTaskCount: 0,
    longTaskMax: 0,
    baseline: null,
    pressAt: 0,
    holds: [],
    gaps: [],
    keyDownAt: Object.create(null),
    lastKeyDown: null,
    printable: 0,
    deletes: 0,
    typedKeys: 0,
    typingStart: null,
    typingEnd: null,
    focusMs: 0,
    focusStamp: null,
    logs: [],
    clicks: [],
    observers: [],
    simTimer: null,
    simRun: 0
  };

  var canvas = document.getElementById("heat-canvas");
  var ctx = canvas.getContext("2d");
  var logBody = document.getElementById("log-body");

  function $(id) {
    return document.getElementById(id);
  }

  function isField(node) {
    return node && FIELDS.indexOf(node.id) !== -1;
  }

  function targetLabel(node) {
    if (!node || node === document || node === window) return "sayfa";
    if (node.id) return node.tagName.toLowerCase() + "#" + node.id;
    var name = node.getAttribute && node.getAttribute("name");
    if (name) return node.tagName.toLowerCase() + "[name=" + name + "]";
    return (node.tagName || "düğüm").toLowerCase();
  }

  function formatMs(value) {
    if (value == null || !isFinite(value)) return "—";
    if (value >= 1000) return (value / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " sn";
    return Math.round(value).toLocaleString("tr-TR") + " ms";
  }

  function formatNumber(value, digits) {
    return Number(value).toLocaleString("tr-TR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function average(list) {
    if (!list.length) return null;
    var sum = 0;
    for (var i = 0; i < list.length; i++) sum += list[i];
    return sum / list.length;
  }

  function rate(metric, value) {
    if (value == null || !isFinite(value)) return { text: "Bekleniyor", cls: "wait" };
    var limits = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000] };
    var band = limits[metric];
    if (value <= band[0]) return { text: "İyi", cls: "good" };
    if (value <= band[1]) return { text: "Geliştirilmeli", cls: "warn" };
    return { text: "Zayıf", cls: "poor" };
  }

  function setBadge(id, rating) {
    var el = $(id);
    el.textContent = rating.text;
    el.className = "badge " + rating.cls;
  }

  function pushLog(type, target, latency) {
    var now = new Date();
    state.logs.unshift({
      time: now.toLocaleTimeString("tr-TR", { hour12: false }) + "." + String(now.getMilliseconds()).padStart(3, "0"),
      type: type,
      target: target,
      latency: latency
    });
    if (state.logs.length > LOG_LIMIT) state.logs.length = LOG_LIMIT;
    renderLog();
  }

  function renderLog() {
    logBody.textContent = "";
    if (!state.logs.length) {
      var empty = document.createElement("tr");
      empty.className = "empty-row";
      var cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = "Henüz olay yok. Bir alana yazın veya ısı haritasına tıklayın.";
      empty.appendChild(cell);
      logBody.appendChild(empty);
      return;
    }
    for (var i = 0; i < state.logs.length; i++) {
      var row = state.logs[i];
      var tr = document.createElement("tr");
      var values = [row.time, row.type, row.target, formatMs(row.latency)];
      for (var c = 0; c < values.length; c++) {
        var td = document.createElement("td");
        td.textContent = values[c];
        tr.appendChild(td);
      }
      logBody.appendChild(tr);
    }
  }

  function renderVitals() {
    $("val-lcp").textContent = state.lcp == null ? "Ölçülmedi" : formatMs(state.lcp);
    $("val-inp").textContent = state.inp == null ? "Ölçülmedi" : formatMs(state.inp);
    $("val-cls").textContent = formatNumber(state.cls, 3);
    $("val-fcp").textContent = state.fcp == null ? "Ölçülmedi" : formatMs(state.fcp);
    setBadge("badge-lcp", rate("lcp", state.lcp));
    setBadge("badge-inp", rate("inp", state.inp));
    setBadge("badge-cls", rate("cls", state.cls));
    setBadge("badge-fcp", rate("fcp", state.fcp));
    if ($("diagnosis-list")) renderDiagnosis();
  }

  function renderNavigation() {
    var nav = state.nav;
    if (!nav) {
      $("val-ttfb").textContent = "—";
      $("val-dcl").textContent = "—";
      $("val-load").textContent = "—";
      return;
    }
    $("val-ttfb").textContent = formatMs(nav.responseStart);
    $("val-dcl").textContent = formatMs(nav.domContentLoadedEventEnd);
    $("val-load").textContent = formatMs(nav.loadEventEnd || nav.loadEventStart);
  }

  function typingWindowMs() {
    if (state.typingStart == null || state.typingEnd == null) return 0;
    return Math.max(0, state.typingEnd - state.typingStart);
  }

  function currentFocusMs() {
    var extra = 0;
    if (state.focusStamp != null) extra = performance.now() - state.focusStamp;
    return state.focusMs + extra;
  }

  function renderTyping() {
    var windowMs = typingWindowMs();
    var minutes = windowMs / 60000;
    var seconds = windowMs / 1000;
    var words = state.printable / 5;
    var wpm = minutes > 0 ? words / minutes : 0;
    var cps = seconds > 0 ? state.printable / seconds : 0;
    var error = state.typedKeys > 0 ? (state.deletes / state.typedKeys) * 100 : 0;
    var hold = average(state.holds);
    var gap = average(state.gaps);

    $("val-wpm").textContent = formatNumber(wpm, 0);
    $("val-cps").textContent = formatNumber(cps, 1);
    $("val-error").textContent = formatNumber(error, 1) + "%";
    $("val-focus").textContent = formatNumber(currentFocusMs() / 1000, 1) + " sn";
    $("val-hold").textContent = hold == null ? "—" : formatMs(hold);
    $("val-gap").textContent = gap == null ? "—" : formatMs(gap);
  }

  function maxDepth(node, depth) {
    var max = depth;
    var children = node.children;
    for (var i = 0; i < children.length; i++) {
      var next = maxDepth(children[i], depth + 1);
      if (next > max) max = next;
    }
    return max;
  }

  function renderDom() {
    $("val-nodes").textContent = document.getElementsByTagName("*").length.toLocaleString("tr-TR");
    $("val-depth").textContent = String(maxDepth(document.documentElement, 1));
    var memory = performance.memory;
    if (memory && typeof memory.usedJSHeapSize === "number") {
      var mb = memory.usedJSHeapSize / (1024 * 1024);
      $("val-heap").textContent = formatNumber(mb, 2) + " MB";
    } else {
      $("val-heap").textContent = "Desteklenmiyor";
    }
    var resources = performance.getEntriesByType ? performance.getEntriesByType("resource") : [];
    $("val-resources").textContent = String(resources.length);
    $("val-long").textContent = state.longTaskCount
      ? state.longTaskCount + " · en uzun " + formatMs(state.longTaskMax)
      : "0";
  }

  function nodeCount() {
    return document.getElementsByTagName("*").length;
  }

  function sessionScore() {
    var score = 100;
    function cut(metric, value, poor, mid) {
      if (value == null) return;
      var kind = rate(metric, value).cls;
      if (kind === "poor") score -= poor;
      else if (kind === "warn") score -= mid;
    }
    cut("lcp", state.lcp, 25, 12);
    cut("fcp", state.fcp, 10, 5);
    cut("inp", state.inp, 25, 12);
    cut("cls", state.cls, 20, 10);
    var nodes = nodeCount();
    if (nodes > 2500) score -= 15;
    else if (nodes > 1600) score -= 8;
    if (state.longTaskMax > 200) score -= 15;
    else if (state.longTaskMax > 50) score -= 6;
    var error = state.typedKeys > 0 ? (state.deletes / state.typedKeys) * 100 : 0;
    if (state.typedKeys >= 8 && error > 25) score -= 8;
    return Math.max(0, Math.round(score));
  }

  function renderDiagnosis() {
    var lines = [];
    var nodes = nodeCount();
    var depth = maxDepth(document.documentElement, 1);
    if (state.lcp == null) lines.push("LCP henüz yok. Bu değer sayfa açılışında bir kez oluşur.");
    else lines.push("LCP " + formatMs(state.lcp) + " — " + rate("lcp", state.lcp).text + ".");
    if (state.inp == null) lines.push("INP henüz yok. Yavaş işlem senaryosundaki düğme bu süreyi üretir.");
    else lines.push("INP " + formatMs(state.inp) + " — " + rate("inp", state.inp).text + ". 200 ms altı rahat, 500 ms üstü belirgin gecikmedir.");
    lines.push("CLS " + formatNumber(state.cls, 3) + " — " + rate("cls", state.cls).text + ".");
    if (nodes > 1600) lines.push("DOM " + nodes.toLocaleString("tr-TR") + " düğüm, derinlik " + depth + ". Ağır katalog tarayıcının her yerleşimde dolaştığı ağacı şişirdi.");
    else lines.push("DOM " + nodes.toLocaleString("tr-TR") + " düğüm, derinlik " + depth + ". Bu boyut rahat.");
    if (state.longTaskCount) lines.push(state.longTaskCount + " uzun görev var; en uzunu " + formatMs(state.longTaskMax) + ". Bu sürede sayfa tıklamaya cevap veremez.");
    if (state.typedKeys >= 8) {
      var error = (state.deletes / state.typedKeys) * 100;
      lines.push("Yazım hata oranı %" + formatNumber(error, 1) + ". Sık silme, alanın zor okunduğuna işaret eder.");
    }
    if (state.baseline) {
      var nodeDelta = nodes - state.baseline.nodes;
      var clsDelta = state.cls - state.baseline.cls;
      lines.push("Referansa göre DOM " + (nodeDelta > 0 ? "+" : "") + nodeDelta.toLocaleString("tr-TR") + ", CLS " + (clsDelta > 0 ? "+" : "") + formatNumber(clsDelta, 3) + ".");
    }
    var title = { sade: "Sade sayfa", urun: "Ürün vitrini", agir: "Ağır katalog", kayma: "Kaymalı yerleşim", yavas: "Yavaş işlem" };
    $("diagnosis-lead").textContent = "Oturum notu " + sessionScore() + " / 100 · " + title[state.scenario];
    var list = $("diagnosis-list");
    list.textContent = "";
    for (var i = 0; i < lines.length; i++) {
      var item = document.createElement("li");
      item.textContent = lines[i];
      list.appendChild(item);
    }
  }

  function renderAll() {
    renderVitals();
    renderNavigation();
    renderTyping();
    renderDom();
    renderDiagnosis();
  }

  function considerInp(duration) {
    if (duration == null || !isFinite(duration)) return;
    if (state.inp == null || duration > state.inp) state.inp = duration;
  }

  function watch(type, handler, options) {
    if (typeof PerformanceObserver === "undefined") return false;
    try {
      var observer = new PerformanceObserver(function (list) {
        handler(list.getEntries());
      });
      observer.observe(options || { type: type, buffered: true });
      state.observers.push(observer);
      return true;
    } catch (err) {
      return false;
    }
  }

  function startObservers() {
    var supported = [];

    if (watch("largest-contentful-paint", function (entries) {
      var last = entries[entries.length - 1];
      if (!last) return;
      state.lcp = last.startTime;
      renderVitals();
      pushLog("LCP", targetLabel(last.element), last.startTime);
    })) supported.push("LCP");

    if (watch("layout-shift", function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].hadRecentInput) state.cls += entries[i].value;
      }
      renderVitals();
    })) supported.push("CLS");

    if (watch("first-input", function (entries) {
      var entry = entries[0];
      if (!entry) return;
      considerInp(entry.duration);
      renderVitals();
      pushLog("İlk giriş", targetLabel(entry.target), entry.processingStart - entry.startTime);
    })) supported.push("FID");

    if (watch("event", function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].interactionId) considerInp(entries[i].duration);
      }
      renderVitals();
    }, { type: "event", buffered: true, durationThreshold: 16 })) supported.push("INP");

    if (watch("longtask", function (entries) {
      for (var i = 0; i < entries.length; i++) {
        state.longTaskCount += 1;
        if (entries[i].duration > state.longTaskMax) state.longTaskMax = entries[i].duration;
        pushLog("Uzun görev", "ana iş parçacığı", entries[i].duration);
      }
      renderDiagnosis();
    })) supported.push("LongTask");

    if (watch("navigation", function (entries) {
      if (entries[0]) {
        state.nav = entries[0];
        renderNavigation();
      }
    })) supported.push("Navigation");

    var existingNav = performance.getEntriesByType && performance.getEntriesByType("navigation");
    if (existingNav && existingNav[0]) {
      state.nav = existingNav[0];
      renderNavigation();
    }

    var status = $("observer-status");
    if (!supported.length) {
      status.textContent = "PerformanceObserver kullanılamıyor";
    } else {
      status.textContent = "Gözlemciler aktif · " + supported.join(", ");
    }
  }

  function beginFocus(target) {
    if (state.focusStamp != null) return;
    state.focusStamp = performance.now();
    pushLog("Odak", targetLabel(target), 0);
  }

  function endFocus(target) {
    if (state.focusStamp == null) return;
    state.focusMs += performance.now() - state.focusStamp;
    state.focusStamp = null;
    pushLog("Odak kaybı", targetLabel(target), 0);
    renderTyping();
  }

  function onKeyDown(event) {
    if (!isField(event.target) || event.repeat) return;
    beginFocus(event.target);
    var now = performance.now();
    state.keyDownAt[event.code] = now;
    if (state.typingStart == null) state.typingStart = now;
    if (state.lastKeyDown != null) state.gaps.push(now - state.lastKeyDown);
    state.lastKeyDown = now;

    var printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    var deleting = event.key === "Backspace" || event.key === "Delete";
    if (printable) {
      state.printable += 1;
      state.typedKeys += 1;
    } else if (deleting) {
      state.deletes += 1;
      state.typedKeys += 1;
    }
    state.typingEnd = now;
    renderTyping();
  }

  function onKeyUp(event) {
    if (!isField(event.target)) return;
    var started = state.keyDownAt[event.code];
    if (started == null) return;
    var hold = performance.now() - started;
    delete state.keyDownAt[event.code];
    state.holds.push(hold);
    state.typingEnd = performance.now();
    pushLog(event.key === "Backspace" || event.key === "Delete" ? "Silme" : "Tuş", targetLabel(event.target), hold);
    renderTyping();
  }

  function onFocusIn(event) {
    if (!isField(event.target)) return;
    beginFocus(event.target);
  }

  function onFocusOut(event) {
    if (!isField(event.target)) return;
    window.setTimeout(function () {
      if (isField(document.activeElement)) return;
      endFocus(event.target);
    }, 0);
  }

  function onPointerDown(event) {
    state.pressAt = performance.now();
    if (isField(event.target)) beginFocus(event.target);
    else endFocus(event.target);
  }

  function clearStage() {
    $("stage").textContent = "";
  }

  function stageBox(text) {
    var box = document.createElement("div");
    box.className = "stage-block";
    var copy = document.createElement("p");
    copy.textContent = text;
    box.appendChild(copy);
    return box;
  }

  function renderSade() {
    $("stage").appendChild(stageBox("Ek bileşen yok. Isı haritası ve alttaki alanlar bu sayfanın etkileşimini ölçer."));
  }

  function renderUrun() {
    var box = stageBox("Ürün ara, sonra sepete ekle. Arama tuşları yazım profiline işlenir.");
    var search = document.createElement("input");
    search.id = "field-search";
    search.type = "search";
    search.placeholder = "Ürün ara";
    search.setAttribute("aria-label", "Ürün ara");
    search.style.marginTop = "10px";
    var grid = document.createElement("div");
    grid.className = "product-grid";
    var cart = document.createElement("p");
    cart.className = "cart-line";
    cart.textContent = "Sepet: 0";
    var count = 0;
    var items = [["Masa lambası", "640 TL"], ["Defter", "85 TL"], ["Kulaklık", "1.250 TL"], ["Kupa", "140 TL"]];
    items.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "mini-card";
      var name = document.createElement("strong");
      name.textContent = item[0];
      var price = document.createElement("span");
      price.textContent = item[1];
      var button = document.createElement("button");
      button.type = "button";
      button.className = "sepet";
      button.textContent = "Sepete ekle";
      button.addEventListener("click", function () {
        count += 1;
        cart.textContent = "Sepet: " + count;
        var latency = state.pressAt ? performance.now() - state.pressAt : 0;
        pushLog("Sepete ekle", "button.sepet", latency);
      });
      card.appendChild(name);
      card.appendChild(price);
      card.appendChild(button);
      card.dataset.name = item[0].toLocaleLowerCase("tr-TR");
      grid.appendChild(card);
    });
    search.addEventListener("input", function () {
      var query = search.value.toLocaleLowerCase("tr-TR");
      var cards = grid.children;
      for (var i = 0; i < cards.length; i++) {
        cards[i].hidden = query.length > 0 && cards[i].dataset.name.indexOf(query) === -1;
      }
    });
    box.appendChild(search);
    box.appendChild(grid);
    box.appendChild(cart);
    $("stage").appendChild(box);
  }

  function renderAgir() {
    var box = stageBox("Aşağıdaki liste ve iç içe ağaç bu sayfanın DOM maliyetidir.");
    var list = document.createElement("div");
    list.className = "heavy-list";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 700; i++) {
      var row = document.createElement("div");
      row.className = "heavy-row";
      var name = document.createElement("span");
      name.textContent = "Kayıt " + (i + 1);
      var meta = document.createElement("span");
      meta.textContent = (i * 3 % 97) + " kb";
      row.appendChild(name);
      row.appendChild(meta);
      frag.appendChild(row);
    }
    list.appendChild(frag);
    var deep = document.createElement("div");
    var cursor = deep;
    for (var d = 0; d < 18; d++) {
      var child = document.createElement("div");
      cursor.appendChild(child);
      cursor = child;
    }
    cursor.textContent = "Derin düğüm";
    box.appendChild(list);
    box.appendChild(deep);
    $("stage").appendChild(box);
  }

  function renderKayma() {
    var box = stageBox("Düğmeye basın. Bant 0,7 saniye sonra açılır; bu gecikme kaymayı kullanıcı girişinden ayırır.");
    var slot = document.createElement("div");
    slot.id = "shift-probe";
    slot.className = "shift-slot";
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "Beklenmedik bant aç";
    button.addEventListener("click", function () {
      window.setTimeout(function () {
        if (!slot.isConnected) return;
        var open = slot.textContent !== "";
        slot.textContent = open ? "" : "Kampanya bandı içeriği aşağı itti";
        slot.style.cssText = open ? "" : "margin-top:8px;padding:10px;border-radius:8px;background:#243240;";
        pushLog("Yerleşim", "div#shift-probe", 700);
        renderAll();
      }, 700);
    });
    box.appendChild(button);
    box.appendChild(slot);
    $("stage").appendChild(box);
  }

  function renderYavas() {
    var box = stageBox("Düğme kasıtlı olarak yaklaşık 320 ms çalışır. INP ve uzun görev bu tıklamadan gelir.");
    var button = document.createElement("button");
    button.type = "button";
    button.id = "btn-slow";
    button.textContent = "Raporu işle";
    button.addEventListener("click", function () {
      var started = performance.now();
      while (performance.now() - started < 320) {}
      var spent = performance.now() - started;
      considerInp(spent);
      pushLog("Yavaş işlem", "button#btn-slow", spent);
      renderAll();
    });
    box.appendChild(button);
    $("stage").appendChild(box);
  }

  function applyScenario(name) {
    state.scenario = SCENARIOS[name] ? name : "sade";
    var buttons = document.querySelectorAll("#scenarios button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-on", buttons[i].dataset.scenario === state.scenario);
    }
    $("scenario-note").textContent = SCENARIOS[state.scenario];
    clearStage();
    if (state.scenario === "urun") renderUrun();
    else if (state.scenario === "agir") renderAgir();
    else if (state.scenario === "kayma") renderKayma();
    else if (state.scenario === "yavas") renderYavas();
    else renderSade();
    pushLog("Senaryo", state.scenario, 0);
    renderAll();
  }

  function takeBaseline() {
    state.baseline = { nodes: nodeCount(), cls: state.cls, inp: state.inp };
    $("btn-baseline").textContent = "Referansı güncelle";
    renderDiagnosis();
  }

  function resizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var ratio = window.devicePixelRatio || 1;
    var width = Math.max(1, Math.round(rect.width * ratio));
    var height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    paintHeat();
  }

  function paintHeat() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < state.clicks.length; i++) {
      var point = state.clicks[i];
      var x = point.nx * canvas.width;
      var y = point.ny * canvas.height;
      var radius = HEAT_RADIUS * (window.devicePixelRatio || 1);
      var gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(255, 86, 70, 0.9)");
      gradient.addColorStop(0.45, "rgba(255, 176, 46, 0.45)");
      gradient.addColorStop(1, "rgba(255, 214, 90, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function addClick(clientX, clientY, latency) {
    var rect = canvas.getBoundingClientRect();
    var x = (clientX - rect.left) * (canvas.width / rect.width);
    var y = (clientY - rect.top) * (canvas.height / rect.height);
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return;
    state.clicks.push({ nx: x / canvas.width, ny: y / canvas.height });
    paintHeat();
    pushLog("Tıklama", "canvas#heat-canvas", latency);
  }

  function bindPointer() {
    var downAt = 0;
    canvas.addEventListener("pointerdown", function (event) {
      downAt = performance.now();
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointerup", function (event) {
      var latency = downAt ? performance.now() - downAt : 0;
      addClick(event.clientX, event.clientY, latency);
      downAt = 0;
    });
  }

  function snapshot() {
    var windowMs = typingWindowMs();
    var minutes = windowMs / 60000;
    var seconds = windowMs / 1000;
    return {
      generatedAt: new Date().toISOString(),
      scenario: state.scenario,
      sessionScore: sessionScore(),
      coreWebVitals: {
        lcpMs: state.lcp,
        fcpMs: state.fcp,
        inpMs: state.inp,
        cls: Number(state.cls.toFixed(4)),
        lcpRating: rate("lcp", state.lcp).text,
        fcpRating: rate("fcp", state.fcp).text,
        inpRating: rate("inp", state.inp).text,
        clsRating: rate("cls", state.cls).text
      },
      longTasks: { count: state.longTaskCount, maxMs: state.longTaskMax },
      navigation: state.nav ? {
        ttfbMs: state.nav.responseStart,
        domContentLoadedMs: state.nav.domContentLoadedEventEnd,
        loadMs: state.nav.loadEventEnd || state.nav.loadEventStart
      } : null,
      dom: {
        nodes: document.getElementsByTagName("*").length,
        maxDepth: maxDepth(document.documentElement, 1)
      },
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize
      } : null,
      typing: {
        wpm: minutes > 0 ? (state.printable / 5) / minutes : 0,
        cps: seconds > 0 ? state.printable / seconds : 0,
        errorRatePercent: state.typedKeys > 0 ? (state.deletes / state.typedKeys) * 100 : 0,
        focusMs: currentFocusMs(),
        avgKeyHoldMs: average(state.holds),
        avgInterKeyDelayMs: average(state.gaps),
        printableKeys: state.printable,
        deleteKeys: state.deletes
      },
      heatmapClicks: state.clicks.length,
      log: state.logs
    };
  }

  function download(filename, mime, text) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() {
    var d = new Date();
    function pad(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function escapeHtml(value) {
    return String(value == null ? "—" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function reportRow(label, value) {
    return "<tr><th>" + escapeHtml(label) + "</th><td>" + escapeHtml(value) + "</td></tr>";
  }

  function exportHtml() {
    var data = snapshot();
    var titles = { sade: "Sade sayfa", urun: "Ürün vitrini", agir: "Ağır katalog", kayma: "Kaymalı yerleşim", yavas: "Yavaş işlem" };
    var heap = data.memory
      ? formatNumber(data.memory.usedJSHeapSize / (1024 * 1024), 2) + " MB"
      : "Desteklenmiyor";
    var notes = document.querySelectorAll("#diagnosis-list li");
    var noteHtml = "";
    for (var n = 0; n < notes.length; n++) noteHtml += "<li>" + escapeHtml(notes[n].textContent) + "</li>";
    var logHtml = "";
    if (!data.log.length) {
      logHtml = "<tr><td colspan=\"4\">Kayıt yok</td></tr>";
    } else {
      for (var i = 0; i < data.log.length; i++) {
        var row = data.log[i];
        logHtml += "<tr><td>" + escapeHtml(row.time) + "</td><td>" + escapeHtml(row.type) + "</td><td>" + escapeHtml(row.target) + "</td><td>" + escapeHtml(formatMs(row.latency)) + "</td></tr>";
      }
    }
    var nav = data.navigation;
    var html = [
      "<!DOCTYPE html>",
      "<html lang=\"tr\"><head><meta charset=\"utf-8\">",
      "<title>Performans ve UX Raporu</title>",
      "<style>",
      "body{margin:0;padding:32px;font-family:Segoe UI,system-ui,sans-serif;color:#17202a;background:#f4f7fb}",
      "h1{margin:0 0 6px;font-size:28px} h2{margin:28px 0 10px;font-size:18px}",
      "p{margin:0;color:#52616f} table{width:100%;border-collapse:collapse;background:#fff}",
      "th,td{padding:8px 10px;border-bottom:1px solid #d9e2ec;text-align:left;font-size:14px}",
      "th{color:#52616f;font-weight:600} .pairs th{width:42%} .card{background:#fff;border:1px solid #d9e2ec;border-radius:12px;padding:16px 18px;margin-top:16px}",
      "ul{margin:8px 0 0;padding-left:18px} li{margin:6px 0}",
      "</style></head><body>",
      "<p>Staj Projesi 05</p>",
      "<h1>Web Performans ve UX Teşhis Raporu</h1>",
      "<p>" + escapeHtml(new Date(data.generatedAt).toLocaleString("tr-TR")) + "</p>",
      "<section class=\"card\"><h2>Oturum</h2><table class=\"pairs\">",
      reportRow("Senaryo", titles[data.scenario] || data.scenario),
      reportRow("Oturum notu", data.sessionScore + " / 100"),
      reportRow("Isı haritası tıklaması", data.heatmapClicks),
      "</table>",
      noteHtml ? "<ul>" + noteHtml + "</ul>" : "",
      "</section>",
      "<section class=\"card\"><h2>Core Web Vitals</h2><table class=\"pairs\">",
      reportRow("LCP", formatMs(data.coreWebVitals.lcpMs) + " · " + data.coreWebVitals.lcpRating),
      reportRow("INP", formatMs(data.coreWebVitals.inpMs) + " · " + data.coreWebVitals.inpRating),
      reportRow("CLS", formatNumber(data.coreWebVitals.cls, 3) + " · " + data.coreWebVitals.clsRating),
      reportRow("FCP", formatMs(data.coreWebVitals.fcpMs) + " · " + data.coreWebVitals.fcpRating),
      "</table></section>",
      "<section class=\"card\"><h2>Sistem ve DOM</h2><table class=\"pairs\">",
      reportRow("DOM düğüm sayısı", data.dom.nodes),
      reportRow("Maksimum ağaç derinliği", data.dom.maxDepth),
      reportRow("JS heap", heap),
      reportRow("Uzun görev", data.longTasks.count + (data.longTasks.maxMs ? " · en uzun " + formatMs(data.longTasks.maxMs) : "")),
      reportRow("TTFB", nav ? formatMs(nav.ttfbMs) : "—"),
      reportRow("DOM Content Loaded", nav ? formatMs(nav.domContentLoadedMs) : "—"),
      reportRow("Load", nav ? formatMs(nav.loadMs) : "—"),
      "</table></section>",
      "<section class=\"card\"><h2>Etkileşim ve hız</h2><table class=\"pairs\">",
      reportRow("WPM", formatNumber(data.typing.wpm, 0)),
      reportRow("CPS", formatNumber(data.typing.cps, 1)),
      reportRow("Hata / silme oranı", formatNumber(data.typing.errorRatePercent, 1) + "%"),
      reportRow("Odaklanma süresi", formatMs(data.typing.focusMs)),
      reportRow("Ort. tuş basılı tutma", formatMs(data.typing.avgKeyHoldMs)),
      reportRow("Ort. tuşlar arası gecikme", formatMs(data.typing.avgInterKeyDelayMs)),
      "</table></section>",
      "<section class=\"card\"><h2>Olay günlüğü</h2><table>",
      "<tr><th>Zaman</th><th>Olay tipi</th><th>Hedef eleman</th><th>Gecikme</th></tr>",
      logHtml,
      "</table></section>",
      "</body></html>"
    ].join("");
    download("performans-ux-rapor-" + stamp() + ".html", "text/html;charset=utf-8", html);
  }

  function stopSimulation() {
    state.simRun += 1;
    $("btn-sim").disabled = false;
  }

  function later(ms, token) {
    return new Promise(function (resolve) {
      state.simTimer = window.setTimeout(function () {
        state.simTimer = null;
        resolve(token === state.simRun);
      }, ms);
    });
  }

  function dispatchKey(target, key, code) {
    var init = { key: key, code: code || (key.length === 1 ? "Key" + key.toUpperCase() : key), bubbles: true };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    if (key === "Backspace") {
      target.value = target.value.slice(0, -1);
    } else if (key.length === 1) {
      target.value += key;
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function runSimulation() {
    stopSimulation();
    var token = state.simRun;
    var button = $("btn-sim");
    button.disabled = true;
    var field = $("field-feedback");
    field.value = "";
    field.focus();
    beginFocus(field);
    var sample = "Bu ornek, yazim hizini ve silme oranini olcer";
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var delay = reduced ? 0 : 28;

    for (var i = 0; i < sample.length; i++) {
      if (token !== state.simRun) return;
      var ch = sample.charAt(i);
      dispatchKey(field, ch === " " ? " " : ch, ch === " " ? "Space" : undefined);
      if (!(await later(delay, token))) return;
    }
    dispatchKey(field, "Backspace", "Backspace");
    dispatchKey(field, "r", "KeyR");

    var rect = canvas.getBoundingClientRect();
    for (var n = 0; n < 18; n++) {
      if (token !== state.simRun) return;
      var x = rect.left + rect.width * (0.15 + Math.random() * 0.7);
      var y = rect.top + rect.height * (0.18 + Math.random() * 0.64);
      addClick(x, y, 12 + Math.round(Math.random() * 40));
      if (!(await later(reduced ? 0 : 40, token))) return;
    }

    if (!(await later(reduced ? 0 : 700, token))) return;
    var probe = document.getElementById("shift-probe");
    if (!probe) {
      probe = document.createElement("div");
      probe.id = "shift-probe";
      $("stage").insertBefore(probe, $("stage").firstChild);
    }
    probe.textContent = "Yerleşim kayması örneği";
    probe.style.cssText = "margin-bottom:12px;padding:8px 10px;border-radius:8px;background:#243240;color:#d5e4f2;font-size:13px;";
    if (token !== state.simRun) return;
    button.disabled = false;
    renderAll();
  }

  function resetSession() {
    stopSimulation();
    state.cls = 0;
    state.inp = null;
    state.holds = [];
    state.gaps = [];
    state.keyDownAt = Object.create(null);
    state.lastKeyDown = null;
    state.printable = 0;
    state.deletes = 0;
    state.typedKeys = 0;
    state.typingStart = null;
    state.typingEnd = null;
    if (state.focusStamp != null && isField(document.activeElement)) {
      state.focusMs = 0;
      state.focusStamp = performance.now();
    } else {
      state.focusMs = 0;
      state.focusStamp = null;
    }
    state.logs = [];
    state.clicks = [];
    state.longTaskCount = 0;
    state.longTaskMax = 0;
    FIELDS.forEach(function (id) {
      var field = $(id);
      if (field) field.value = "";
    });
    var probe = document.getElementById("shift-probe");
    if (probe && state.scenario === "kayma") {
      probe.textContent = "";
      probe.style.cssText = "";
    } else if (probe) {
      probe.remove();
    }
    paintHeat();
    renderLog();
    renderAll();
  }

  $("ux-form").addEventListener("submit", function (event) { event.preventDefault(); });
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", onPointerDown);
  $("btn-sim").addEventListener("click", function () { runSimulation(); });
  $("btn-reset").addEventListener("click", resetSession);
  $("btn-html").addEventListener("click", exportHtml);
  $("btn-baseline").addEventListener("click", takeBaseline);
  $("scenarios").addEventListener("click", function (event) {
    var button = event.target.closest("[data-scenario]");
    if (button) applyScenario(button.dataset.scenario);
  });
  window.addEventListener("resize", resizeCanvas);

  function readPaint() {
    if (state.fcp != null) return;
    var paints = performance.getEntriesByType ? performance.getEntriesByType("paint") : [];
    for (var i = 0; i < paints.length; i++) {
      if (paints[i].name === "first-contentful-paint") state.fcp = paints[i].startTime;
    }
    if (state.fcp != null) renderVitals();
  }

  resizeCanvas();
  bindPointer();
  startObservers();
  readPaint();
  applyScenario("sade");
  window.setInterval(function () {
    readPaint();
    renderDom();
    renderTyping();
    renderDiagnosis();
    if (!state.nav || !state.nav.loadEventEnd) {
      var nav = performance.getEntriesByType && performance.getEntriesByType("navigation");
      if (nav && nav[0]) {
        state.nav = nav[0];
        renderNavigation();
      }
    }
  }, 1000);
})();
