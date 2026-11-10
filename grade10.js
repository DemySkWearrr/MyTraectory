"use strict";

const grade10Status = {
  submitted: "На проверке",
  revision: "Нужна доработка",
  approved: "Зачтено"
};

const grade10CourseTitles = { web: "Веб-моделирование", python: "Python", telegram: "Telegram-боты" };

async function loadGrade10Attempts(studentId, courseId) {
  const rows = [];
  const pageSize = 50;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseClient.from("grade10_attempts")
      .select("id,course_id,lesson_no,attempt_no,answer,status,grade,teacher_comment,recommendation,submitted_at,reviewed_at")
      .eq("user_id", studentId).eq("course_id", courseId)
      .order("lesson_no").order("attempt_no", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

function grade10Feedback(attempt) {
  if (attempt.status === "submitted") return "";
  return '<div class="review ' + attempt.status + '">' +
    '<b>Оценка: ' + esc(attempt.grade) + '</b>' +
    '<p><b>Комментарий:</b></p><pre>' + esc(attempt.teacher_comment) + '</pre>' +
    '<p><b>Рекомендация:</b></p><pre>' + esc(attempt.recommendation) + '</pre></div>';
}

function grade10History(attempts) {
  return '<details><summary>История отправок (' + attempts.length + ')</summary>' +
    attempts.map(attempt =>
      '<div class="student-row"><b>Попытка ' + esc(attempt.attempt_no) + '</b> · ' +
      grade10Status[attempt.status] + ' · ' + esc(new Date(attempt.submitted_at).toLocaleString("ru-RU")) +
      '<pre><code>' + esc(attempt.answer) + '</code></pre>' + grade10Feedback(attempt) + '</div>'
    ).join("") + '</details>';
}

async function enterGrade10Student() {
  const viewer = user;
  const state = { courseId: "web", lessonNo: 1, attempts: [], request: 0 };
  $("intro").textContent = "Отправь решение учителю. Если он вернёт работу, исправь её и отправь новую версию.";
  $("trackTabs").innerHTML = Object.entries(grade10CourseTitles).map(([id, label]) =>
    '<button data-grade10-course="' + id + '" class="' + (id === state.courseId ? "" : "secondary") + '">' +
    esc(label) + '</button>').join("") +
    '<button class="secondary" id="refreshGrade10">Обновить проверки</button>';

  async function refresh() {
    const request = ++state.request;
    const course = state.courseId;
    $("lessonList").replaceChildren();
    $("lessonContent").textContent = "Загружаем работы…";
    $("percent").textContent = "—";
    $("bar").style.width = "0%";
    $("doneCount").textContent = "—";
    try {
      const attempts = await loadGrade10Attempts(viewer.id, course);
      if (user !== viewer || request !== state.request) return;
      state.attempts = attempts;
      render();
    } catch {
      if (user === viewer && request === state.request) {
        $("lessonContent").textContent = "Не удалось загрузить работы. Нажми «Обновить проверки».";
      }
    }
  }

  function render() {
    const lessons = grade10Lessons[state.courseId];
    const latest = new Map();
    for (const attempt of state.attempts) {
      if (!latest.has(attempt.lesson_no)) latest.set(attempt.lesson_no, attempt);
    }
    const count = [...latest.values()].filter(row => row.status === "approved").length;
    const percent = Math.round(count / lessons.length * 100) + "%";
    $("percent").textContent = percent;
    $("bar").style.width = percent;
    $("doneCount").textContent = count + " / " + lessons.length;
    $("points").textContent = "Проверка учителя";
    $("lessonList").innerHTML = lessons.map(([title], index) => {
      const number = index + 1;
      const status = latest.get(number)?.status;
      const button = '<button class="lesson-btn' + (status === "approved" ? " done" : "") +
        '" data-grade10-lesson="' + number + '" aria-pressed="' + (number === state.lessonNo) + '">';
      return button + '<span>' + number + '. ' + esc(title) + '</span><span class="small">' +
        (grade10Status[status] || "") + '</span></button>';
    }).join("");
    $("lessonList").querySelectorAll("[data-grade10-lesson]").forEach(button => {
      button.addEventListener("click", () => {
        state.lessonNo = Number(button.dataset.grade10Lesson);
        render();
      });
    });
    renderLesson(latest.get(state.lessonNo), lessons[state.lessonNo - 1]);
  }

  function renderLesson(attempt, [title, theory, task]) {
    const courseId = state.courseId;
    const lessonNo = state.lessonNo;
    const attempts = state.attempts.filter(row => row.lesson_no === lessonNo);
    const canSubmit = !attempt || attempt.status === "revision";
    const example = grade10Examples[courseId]?.[lessonNo];
    $("lessonContent").innerHTML = '<h2>' + lessonNo + '. ' + esc(title) + '</h2>' +
      '<span class="pill">' + (grade10Status[attempt?.status] || "Работа не отправлена") + '</span>' +
      '<h3>Что нужно знать</h3><p>' + esc(theory) + '</p>' +
      (example ? '<h3>Пример</h3><pre><code>' + esc(example.code) + '</code></pre>' : "") +
      '<h3>Задание</h3><p>' + esc(task) + '</p>' +
      (example?.check ? '<p><b>Проверь себя:</b> ' + esc(example.check) + '</p>' : "") +
      (attempt ? grade10Feedback(attempt) + grade10History(attempts) : "") +
      (canSubmit ? '<form id="grade10Submit"><label for="grade10Answer">Решение</label>' +
        '<textarea id="grade10Answer" required maxlength="20000">' + esc(attempt?.answer) + '</textarea>' +
        '<button>' + (attempt ? "Отправить исправление" : "Отправить на проверку") + '</button>' +
        '<p class="small" role="status"></p></form>' : "");
    if (!canSubmit) return;

    $("grade10Submit").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const message = form.querySelector("[role=status]");
      const answer = $("grade10Answer").value;
      if (!answer.trim()) {
        message.textContent = "Добавь решение.";
        return;
      }
      button.disabled = true;
      try {
        const { data, error } = await supabaseClient.rpc("grade10_submit", {
          p_course_id: courseId, p_lesson_no: lessonNo, p_answer: answer
        });
        if (error || !data) throw error;
        if (user === viewer && form.isConnected) {
          state.attempts.unshift(data);
          render();
        }
      } catch {
        message.textContent = "Не удалось отправить. Обнови проверки, чтобы узнать, принята ли работа.";
      } finally {
        button.disabled = false;
      }
    });
  }

  $("trackTabs").querySelectorAll("[data-grade10-course]").forEach(button => {
    button.addEventListener("click", () => {
      state.courseId = button.dataset.grade10Course;
      state.lessonNo = 1;
      $("trackTabs").querySelectorAll("[data-grade10-course]").forEach(tab =>
        tab.classList.toggle("secondary", tab !== button));
      void refresh();
    });
  });
  $("refreshGrade10").addEventListener("click", refresh);
  await refresh();
}

async function renderGrade10Teacher() {
  const panel = $("grade10Teacher");
  const viewer = user;
  panel.innerHTML = '<h2>10 класс</h2><p role="status">Загружаем группы…</p>';
  const [groups, enrollments] = await Promise.all([
    supabaseClient.from("grade10_groups").select("code,title").order("code"),
    supabaseClient.from("grade10_enrollments").select("user_id,group_code,profiles(full_name)")
      .order("group_code").order("user_id")
  ]);
  if (user !== viewer) return;
  if (groups.error || enrollments.error) {
    panel.querySelector("[role=status]").textContent = "Кабинет 10 класса недоступен. Проверь миграцию и обнови страницу.";
    return;
  }

  const options = groups.data.map(row =>
    '<option value="' + esc(row.code) + '">' + esc(row.title) + '</option>').join("");
  const courseOptions = Object.entries(grade10CourseTitles).map(([id, label]) =>
    '<option value="' + id + '">' + esc(label) + '</option>').join("");
  panel.innerHTML = '<h2>10 класс</h2><section id="grade10Roster"></section>' +
    '<details id="grade10CreateDetails"><summary>Создать ученика</summary>' +
    '<form id="grade10Create"><label>Логин<input name="username" required minlength="3" maxlength="64" autocomplete="off"></label>' +
    '<input type="hidden" name="rosterId"><p id="grade10RosterSelection" class="small"></p>' +
    '<label>Имя и фамилия<input name="fullName" required minlength="2" maxlength="120"></label>' +
    '<label>Группа<select name="groupCode" required><option value="">Выбери группу</option>' + options + '</select></label>' +
    '<label>Временный пароль<input type="password" name="temporaryPassword" required minlength="12" maxlength="72" autocomplete="new-password"></label>' +
    '<div class="row"><button type="button" class="secondary" id="grade10Generate">Сгенерировать логин и пароль</button>' +
    '<button type="button" class="secondary" id="grade10ClearCreate">Очистить форму</button>' +
    '<button type="submit">Создать аккаунт</button></div><p class="small" role="status"></p></form>' +
    '<div id="grade10NewAccount"></div></details>' +
    '<label>Группа<select id="grade10Group">' + options + '</select></label>' +
    '<label>Ученик<select id="grade10Pupil"></select></label>' +
    '<section id="grade10Account" class="reset-box hidden"><h3>Управление аккаунтом</h3>' +
    '<form id="grade10Move"><label>Новая группа<select name="groupCode" required>' + options + '</select></label>' +
    '<button type="submit" class="secondary">Перевести в группу</button><p class="small" role="status"></p></form>' +
    '<form id="grade10Reset"><label>Новый временный пароль<input type="password" name="temporaryPassword" ' +
    'required minlength="12" maxlength="72" autocomplete="new-password"></label>' +
    '<div class="row"><button type="button" class="secondary" id="grade10GenerateReset">Сгенерировать пароль</button>' +
    '<button type="submit" class="secondary">Сбросить пароль</button></div>' +
    '<p class="small" role="status"></p></form><div id="grade10ResetPassword"></div></section>' +
    '<label>Курс<select id="grade10Course">' + courseOptions + '</select></label>' +
    '<button id="grade10Reload" class="secondary">Обновить работы</button>' +
    '<div id="grade10Queue" aria-live="polite"></div>';

  $("grade10Create").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[role=status]");
    const fields = Object.fromEntries(new FormData(form));
    $("grade10NewAccount").replaceChildren();
    button.disabled = true;
    try {
      const { data, error } = await supabaseClient.functions.invoke("create-students", {
        body: fields
      });
      if (user !== viewer || !form.isConnected) return;
      if (error || !data?.success) {
        message.textContent = "Создание не подтверждено. Проверь логин в Supabase перед повтором.";
        return;
      }
      const pupil = { user_id: data.id, group_code: data.groupCode, profiles: { full_name: data.fullName } };
      enrollments.data.push(pupil);
      $("grade10Group").value = pupil.group_code;
      setPupils();
      $("grade10Pupil").value = pupil.user_id;
      form.reset();
      form.elements.fullName.readOnly = false;
      $("grade10RosterSelection").textContent = "";
      showTemporaryCredentials($("grade10NewAccount"), data.username || fields.username, fields.temporaryPassword);
      message.textContent = "Аккаунт создан.";
      syncAccountPanel();
      void renderGrade10Roster(viewer, prefillFromRoster);
      void loadQueue();
    } catch {
      message.textContent = "Не удалось проверить результат. Обнови список учеников перед повтором.";
    } finally {
      form.elements.temporaryPassword.value = "";
      button.disabled = false;
    }
  });

  $("grade10Generate").addEventListener("click", () => {
    const form = $("grade10Create");
    if (!form.elements.username.value) form.elements.username.value = "g10-" + randomHex(5);
    form.elements.temporaryPassword.value = randomTemporaryPassword();
  });
  $("grade10ClearCreate").addEventListener("click", () => {
    const form = $("grade10Create");
    if (form.querySelector('button[type="submit"]').disabled) return;
    form.reset();
    form.elements.fullName.readOnly = false;
    form.querySelector("[role=status]").textContent = "";
    $("grade10RosterSelection").textContent = "";
    $("grade10NewAccount").replaceChildren();
  });

  function prefillFromRoster(row) {
    const form = $("grade10Create");
    if (form.querySelector('button[type="submit"]').disabled) return;
    form.reset();
    form.elements.rosterId.value = row.roster_id;
    form.elements.fullName.value = row.full_name;
    form.elements.fullName.readOnly = true;
    const group = String(row.group_name || "").trim().match(/^(?:10[-\s]|группа\s*№?\s*)([1-7])$/iu);
    if (group) form.elements.groupCode.value = "10-" + group[1];
    $("grade10RosterSelection").textContent = "Из списка: " + row.group_name + ". Проверь выбранную учебную группу.";
    $("grade10NewAccount").replaceChildren();
    $("grade10CreateDetails").open = true;
    $("grade10Generate").click();
    form.elements.groupCode.focus();
  }

  function setPupils() {
    const group = $("grade10Group").value;
    $("grade10Pupil").innerHTML = enrollments.data.filter(row => row.group_code === group)
      .sort((a, b) => (a.profiles?.full_name || "").localeCompare(b.profiles?.full_name || "", "ru"))
      .map(row => '<option value="' + esc(row.user_id) + '">' +
        esc(row.profiles?.full_name || "Профиль недоступен") + '</option>').join("");
  }

  function selectedPupil() {
    return enrollments.data.find(row => row.user_id === $("grade10Pupil").value);
  }

  function syncAccountPanel() {
    const pupil = selectedPupil();
    $("grade10Account").classList.toggle("hidden", !pupil);
    $("grade10Reset").reset();
    $("grade10ResetPassword").replaceChildren();
    $("grade10Reset").querySelector("[role=status]").textContent = "";
    $("grade10Move").querySelector("[role=status]").textContent = "";
    if (pupil) $("grade10Move").elements.groupCode.value = pupil.group_code;
  }

  $("grade10Move").addEventListener("submit", async event => {
    event.preventDefault();
    const pupil = selectedPupil();
    if (!pupil) return;
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const message = form.querySelector("[role=status]");
    const destination = form.elements.groupCode.value;
    if (destination === pupil.group_code) {
      message.textContent = "Ученик уже в этой группе.";
      return;
    }
    button.disabled = true;
    try {
      const { error } = await supabaseClient.rpc("grade10_move_student", {
        p_user: pupil.user_id, p_from: pupil.group_code, p_to: destination
      });
      if (error) throw error;
      pupil.group_code = destination;
      if (user !== viewer || !form.isConnected) return;
      $("grade10Group").value = destination;
      setPupils();
      $("grade10Pupil").value = pupil.user_id;
      syncAccountPanel();
      message.textContent = "Группа изменена. Работы и оценки сохранены.";
      void loadQueue();
    } catch {
      message.textContent = "Не удалось перевести. Обнови страницу и проверь текущую группу.";
    } finally {
      button.disabled = false;
    }
  });

  $("grade10GenerateReset").addEventListener("click", () => {
    $("grade10Reset").elements.temporaryPassword.value = randomTemporaryPassword();
  });
  $("grade10Reset").addEventListener("submit", async event => {
    event.preventDefault();
    const pupil = selectedPupil();
    if (!pupil || !confirm("Сбросить пароль: " + (pupil.profiles?.full_name || "выбранный ученик") + "?")) return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector("[role=status]");
    const password = form.elements.temporaryPassword.value;
    button.disabled = true;
    try {
      const { data, error } = await supabaseClient.functions.invoke("create-students", {
        body: { action: "reset", userId: pupil.user_id, temporaryPassword: password }
      });
      if (error || !data?.success) throw error;
      if (user !== viewer || !form.isConnected || selectedPupil() !== pupil) return;
      message.textContent = "Пароль сброшен. При следующем входе ученик сменит временный пароль.";
      showTemporaryCredentials($("grade10ResetPassword"), "", password);
    } catch {
      message.textContent = "Сброс не подтверждён. Повтори его для выбранного ученика.";
    } finally {
      form.reset();
      button.disabled = false;
    }
  });

  let requestNumber = 0;
  async function loadQueue() {
    const request = ++requestNumber;
    const holder = $("grade10Queue");
    const pupilId = $("grade10Pupil").value;
    const courseId = $("grade10Course").value;
    holder.textContent = pupilId ? "Загружаем работы…" : "В этой группе пока нет учеников.";
    if (!pupilId) return;
    try {
      const attempts = await loadGrade10Attempts(pupilId, courseId);
      if (user !== viewer || request !== requestNumber) return;
      const lessons = new Map();
      for (const row of attempts) {
        if (!lessons.has(row.lesson_no)) lessons.set(row.lesson_no, []);
        lessons.get(row.lesson_no).push(row);
      }
      holder.innerHTML = [...lessons].map(([number, versions]) => {
        const row = versions[0];
        const title = grade10Lessons[courseId][number - 1][0];
        return '<details class="student-row"><summary>' + number + '. ' + esc(title) + ' · ' +
          grade10Status[row.status] + '</summary>' + grade10History(versions) +
          (row.status === "submitted" ? reviewForm(row) : "") + '</details>';
      }).join("") || "<p>Работ по этому курсу пока нет.</p>";
      holder.querySelectorAll("form[data-attempt]").forEach(form => form.addEventListener("submit", saveReview));
    } catch {
      if (user === viewer && request === requestNumber) holder.textContent = "Не удалось загрузить работы.";
    }
  }

  async function saveReview(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const button = form.querySelector("button");
    const message = form.querySelector("[role=status]");
    button.disabled = true;
    try {
      const { error } = await supabaseClient.rpc("grade10_review", {
        p_id: form.dataset.attempt, p_status: fields.get("status"), p_grade: Number(fields.get("grade")),
        p_comment: fields.get("comment"), p_recommendation: fields.get("recommendation")
      });
      if (error) throw error;
      if (user === viewer && form.isConnected) await loadQueue();
    } catch {
      message.textContent = "Не удалось сохранить. Обнови работы и проверь, не была ли попытка уже оценена.";
    } finally {
      button.disabled = false;
    }
  }

  $("grade10Group").addEventListener("change", () => { setPupils(); syncAccountPanel(); void loadQueue(); });
  $("grade10Pupil").addEventListener("change", () => { syncAccountPanel(); void loadQueue(); });
  $("grade10Course").addEventListener("change", loadQueue);
  $("grade10Reload").addEventListener("click", loadQueue);
  setPupils();
  syncAccountPanel();
  await Promise.all([loadQueue(), renderGrade10Roster(viewer, prefillFromRoster)]);
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
}

function randomTemporaryPassword() {
  return "Tg!7-" + randomHex(12);
}

function showTemporaryCredentials(holder, username, password) {
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.textContent = (username ? "Логин: " + username + " · " : "") + "Временный пароль: " + password +
    ". Передай лично ученику.";
  const hide = document.createElement("button");
  hide.type = "button";
  hide.className = "secondary";
  hide.textContent = "Скрыть пароль";
  hide.addEventListener("click", () => holder.replaceChildren());
  holder.replaceChildren(notice, hide);
}

async function renderGrade10Roster(viewer, choosePupil) {
  const section = $("grade10Roster");
  section.innerHTML = '<h3>Список по группам</h3><p role="status">Загружаем список…</p>';
  const { data, error } = await supabaseClient.rpc("grade10_roster_for_accounts");
  if (user !== viewer || !section.isConnected) return;
  const message = section.querySelector("[role=status]");
  if (error) {
    message.textContent = ["PGRST202", "42883"].includes(error.code)
      ? "Чтобы показать ранее сохранённый список, подключи его в Supabase."
      : "Не удалось загрузить список групп. Обнови страницу.";
    return;
  }

  const groups = new Map();
  for (const row of data || []) {
    if (!groups.has(row.source_group_id)) {
      groups.set(row.source_group_id, { title: row.group_name, pupils: [] });
    }
    if (row.full_name) groups.get(row.source_group_id).pupils.push(row);
  }
  if (!groups.size) {
    message.textContent = "В сохранённом списке нет групп 10 класса.";
    return;
  }

  message.textContent = "Список групп из Supabase. Для создания аккаунта сначала проверь, есть ли ученик в ведомости.";
  for (const group of groups.values()) {
    const details = document.createElement("details");
    details.className = "student-row";
    const summary = document.createElement("summary");
    summary.textContent = group.title + " · " + group.pupils.length;
    details.append(summary);
    const list = document.createElement("ul");
    for (const row of group.pupils) {
      const item = document.createElement("li");
      item.textContent = row.full_name + " ";
      if (row.has_account) {
        item.append("· есть аккаунт с таким именем");
      } else {
        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = "secondary";
        choose.textContent = "Подготовить аккаунт";
        choose.addEventListener("click", () => choosePupil(row));
        item.append(choose);
      }
      list.append(item);
    }
    if (group.pupils.length) details.append(list);
    else details.append("В списке пока нет учеников.");
    section.append(details);
  }
}

function reviewForm(row) {
  return '<h3>Текущая работа</h3><pre><code>' + esc(row.answer) + '</code></pre>' +
    '<form class="review" data-attempt="' + esc(row.id) + '">' +
    '<label>Оценка<select name="grade" required><option value="">Выбери оценку</option>' +
    '<option>2</option><option>3</option><option>4</option><option>5</option></select></label>' +
    '<label>Решение<select name="status" required><option value="">Выбери результат</option>' +
    '<option value="revision">Вернуть на доработку</option><option value="approved">Зачесть</option></select></label>' +
    '<label>Комментарий<textarea name="comment" required maxlength="10000"></textarea></label>' +
    '<label>Рекомендация<textarea name="recommendation" required maxlength="10000"></textarea></label>' +
    '<button>Сохранить проверку</button><p role="status"></p></form>';
}
