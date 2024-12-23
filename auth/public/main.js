/* global UIkit, Vue */

(() => {
  const notification = (config) =>
    UIkit.notification({
      pos: "top-right",
      timeout: 5000,
      ...config,
    });

  const alert = (message) =>
    notification({
      message,
      status: "danger",
    });

  const info = (message) =>
    notification({
      message,
      status: "success",
    });

  // Обёртка над fetch
  const fetchJson = (...args) =>
    fetch(...args)
      .then((res) =>
        res.ok
          ? res.status !== 204
            ? res.json()
            : null
          : res.text().then((text) => {
              throw new Error(text);
            })
      )
      .catch((err) => {
        alert(err.message);
      });

  new Vue({
    el: "#app",
    data: {
      desc: "",
      activeTimers: [],
      oldTimers: [],
      ws: null, // WebSocket
    },
    methods: {
      // ----- HTTP -----
      fetchActiveTimers() {
        fetchJson("/api/timers?isActive=true").then((activeTimers) => {
          if (activeTimers) this.activeTimers = activeTimers;
        });
      },
      fetchOldTimers() {
        fetchJson("/api/timers?isActive=false").then((oldTimers) => {
          if (oldTimers) this.oldTimers = oldTimers;
        });
      },
      createTimer() {
        const description = this.desc.trim();
        if (!description) return;
        this.desc = "";
        fetchJson("/api/timers", {
          method: "post",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        }).then((res) => {
          if (res && res.id) {
            info(`Created new timer "${description}" [${res.id}]`);
            this.fetchActiveTimers();
          }
        });
      },
      stopTimer(id) {
        fetchJson(`/api/timers/${id}/stop`, {
          method: "post",
        }).then(() => {
          info(`Stopped the timer [${id}]`);
          this.fetchActiveTimers();
          this.fetchOldTimers();
        });
      },

      // ----- WebSocket -----
      initWebSocket() {
        // Если сервер на 3000:
        this.ws = new WebSocket("ws://localhost:3000");

        this.ws.onopen = () => {
          info("WebSocket connected!");
        };
        this.ws.onmessage = (event) => {
          try {
            const { type, data } = JSON.parse(event.data);
            if (type === "all_timers") {
              if (data.activeTimers) this.activeTimers = data.activeTimers;
              if (data.oldTimers) this.oldTimers = data.oldTimers;
            }
            // Если есть "active_timers" (пример), можно тоже обработать
          } catch (err) {
            console.error("WS message error:", err);
          }
        };
        this.ws.onerror = (err) => {
          alert(`WebSocket error: ${err.message || err}`);
        };
        this.ws.onclose = () => {
          info("WebSocket connection closed.");
        };
      },

      // Пример использования WS: createTimerViaWS
      createTimerViaWS() {
        const description = this.desc.trim();
        if (!description || !this.ws) return;
        this.desc = "";
        const msg = {
          type: "create_timer",
          data: { description },
        };
        this.ws.send(JSON.stringify(msg));
      },
      stopTimerViaWS(id) {
        if (!id || !this.ws) return;
        const msg = {
          type: "stop_timer",
          data: { id },
        };
        this.ws.send(JSON.stringify(msg));
      },

      // ----- Форматирование -----
      formatTime(ts) {
        return new Date(ts).toTimeString().split(" ")[0];
      },
      formatDuration(ms) {
        if (!ms) return "00:00";
        let sec = Math.floor(ms / 1000);
        const s = sec % 60;
        sec = Math.floor(sec / 60);
        const m = sec % 60;
        const h = Math.floor(sec / 60);
        return [h > 0 ? h : null, m, s]
          .filter((x) => x !== null)
          .map((x) => (x < 10 ? "0" : "") + x)
          .join(":");
      },
    },
    created() {
      // При загрузке:
      this.fetchActiveTimers();
      this.fetchOldTimers();

      // Обновляем активные таймеры каждую секунду
      // (Можно отключить, если будем полагаться только на WS)
      setInterval(() => {
        this.fetchActiveTimers();
      }, 1000);

      // Инициализируем WebSocket
      this.initWebSocket();
    },
  });
})();
