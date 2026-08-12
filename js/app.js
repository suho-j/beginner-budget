/* beginner-budget-app app.js */
(function (window, document) {
  'use strict';

  let state = window.BudgetStorage.loadState();
  let elements;
  let cloudReadiness = 'signed-out';
  let signedInUser = null;
  let mutationInFlight = false;
  const viewState = { tab: 'home', month: '', selectedDate: '' };
  let recurringTemplateEditId = '';
  let recurringOccurrences = [];
  const MAX_IMPORT_BYTES = 1024 * 1024;

  function syncMutationAvailability() {
    if (!elements) return;
    const writeDisabled = cloudReadiness !== 'ready' || mutationInFlight;
    document.querySelectorAll('[data-cloud-write]').forEach((control) => {
      control.disabled = writeDisabled;
    });
    elements.recurringTemplateCancel.disabled = mutationInFlight;
    elements.recurringConfirmCancel.disabled = mutationInFlight;
    const canReadCloud = Boolean(signedInUser)
      && ['ready', 'load-error'].includes(cloudReadiness)
      && !mutationInFlight;
    elements.cloudDownloadButton.disabled = !canReadCloud;
    elements.cloudLogoutButton.disabled = !canReadCloud;
  }

  function setCloudReadiness(readiness, user = signedInUser) {
    cloudReadiness = readiness;
    signedInUser = user || null;
    window.BudgetUI.updateCloudStatus(elements, signedInUser, cloudReadiness);
    syncMutationAvailability();
  }

  function setGlobalMessage(message, kind = 'error') {
    window.BudgetUI.setMessage(elements.globalMessage, message, kind);
  }

  function clearMutationMessages() {
    for (const messageElement of [
      elements.globalMessage,
      elements.toolMessage,
      elements.formMessage,
      elements.budgetMessage,
      elements.categoryBudgetMessage,
      elements.monthStartMessage,
      elements.editMessage,
      elements.recurringTemplateMessage,
      elements.recurringConfirmMessage
    ]) window.BudgetUI.setMessage(messageElement, '', null);
  }

  function isCloudConflict(error) {
    const message = error && error.message ? String(error.message) : '';
    return String(error && error.code) === '40001'
      || message.includes('다른 브라우저에서')
      || message.includes('거래가 이미 변경되었거나 삭제되었어요.');
  }

  function refuseMutation() {
    if (cloudReadiness !== 'ready') {
      if (cloudReadiness === 'load-error' && elements.globalMessage.textContent.trim()) return true;
      const message = cloudReadiness === 'load-error'
        ? '클라우드 데이터를 다시 불러온 뒤 저장해 주세요.'
        : cloudReadiness === 'signed-out'
          ? '로그인하고 클라우드 데이터를 불러온 뒤 저장해 주세요.'
          : '클라우드 데이터를 불러온 뒤 저장해 주세요.';
      setGlobalMessage(message, 'error');
      return true;
    }
    if (mutationInFlight) {
      setGlobalMessage('다른 저장 작업이 진행 중이에요. 완료된 뒤 다시 시도해 주세요.', 'error');
      return true;
    }
    return false;
  }

  function beginMutation() {
    if (refuseMutation()) return false;
    mutationInFlight = true;
    syncMutationAvailability();
    return true;
  }

  function endMutation() {
    mutationInFlight = false;
    syncMutationAvailability();
  }

  async function runExclusiveMutation(action, messageElement, failurePrefix) {
    if (!beginMutation()) return { ok: false, blocked: true, value: null };
    try {
      return { ok: true, blocked: false, value: await action() };
    } catch (error) {
      const message = `${failurePrefix}: ${error.message}`;
      const target = messageElement || elements.globalMessage;
      window.BudgetUI.setMessage(
        target,
        message,
        'error'
      );
      if (isCloudConflict(error)) {
        setCloudReadiness('load-error', signedInUser);
        if (target !== elements.globalMessage) setGlobalMessage(message, 'error');
      }
      return { ok: false, blocked: false, value: null };
    } finally {
      endMutation();
    }
  }

  async function persistRemoteFirst(
    nextState,
    remoteAction,
    messageElement,
    busyButton = null,
    failurePrefix = 'Supabase 저장 실패'
  ) {
    const result = await runExclusiveMutation(async () => {
      await remoteAction();
      state = window.BudgetStorage.saveState(nextState).state;
      render();
      return true;
    }, messageElement, failurePrefix);
    return result.ok;
  }

  function replaceAllRemoteFirst(
    nextState,
    messageElement,
    busyButton,
    failurePrefix = 'Supabase 저장 실패'
  ) {
    const expectedState = state;
    return persistRemoteFirst(
      nextState,
      () => window.BudgetCloud.uploadState(nextState, expectedState),
      messageElement,
      busyButton,
      failurePrefix
    );
  }

  function currentBudgetMonth() {
    return window.BudgetStorage.monthKeyForDate(window.BudgetStorage.localDateString(), state.monthStartDay || 1)
      || window.BudgetStorage.localMonthString();
  }

  function activeFilters() {
    return {
      month: viewState.month,
      monthStartDay: state.monthStartDay || 1,
      type: elements.filterType.value || 'all',
      category: elements.filterCategory.value || 'all',
      query: elements.filterQuery.value || ''
    };
  }

  function render() {
    const filters = activeFilters();
    elements.monthInput.value = viewState.month;
    const selectedBudget = window.BudgetStorage.budgetForMonth(state, filters.month);
    if (document.activeElement !== elements.monthStartInput) {
      elements.monthStartInput.value = state.monthStartDay || 1;
    }
    if (document.activeElement !== elements.budgetInput) {
      elements.budgetInput.value = selectedBudget.monthlyBudget;
    }
    window.BudgetUI.syncCategoryBudgetInputs(elements, selectedBudget.categoryBudgets);

    const period = window.BudgetStorage.periodRangeForMonth(filters.month, filters.monthStartDay);
    const summary = window.BudgetTransactions.summarize(
      state.transactions,
      selectedBudget.monthlyBudget,
      filters.month,
      new Date(),
      selectedBudget.categoryBudgets,
      filters.monthStartDay
    );
    const list = window.BudgetTransactions.filterTransactions(state.transactions, filters);
    const calendarDays = window.BudgetStorage.calendarDaysForBudgetMonth(filters.month, filters.monthStartDay);
    const transactionsByDate = window.BudgetTransactions.summarizeTransactionsByDate(
      state.transactions,
      filters.month,
      filters.monthStartDay
    );
    const selectedRows = viewState.selectedDate && transactionsByDate[viewState.selectedDate]
      ? transactionsByDate[viewState.selectedDate].transactions
      : [];

    window.BudgetUI.renderSummary(elements, summary, filters.month, period);
    window.BudgetUI.renderList(elements, list);
    window.BudgetUI.renderCalendar(elements, calendarDays, transactionsByDate, viewState.selectedDate);
    window.BudgetUI.renderCalendarDetails(elements, viewState.selectedDate, selectedRows);
    recurringOccurrences = window.BudgetTransactions.deriveRecurringExpenseOccurrences(
      state,
      viewState.month,
      new Date()
    );
    window.BudgetUI.renderUpcomingRecurringExpenses(elements, recurringOccurrences);
    window.BudgetUI.renderRecurringExpenseTemplates(elements, state.recurringExpenseTemplates);
    window.BudgetUI.setActiveTab(elements, viewState.tab);
    elements.calendarPeriodLabel.textContent = `${period.start} ~ ${period.end}`;
    syncMutationAvailability();
  }

  function resetRecurringInteractionState() {
    recurringTemplateEditId = '';
    recurringOccurrences = [];
    window.BudgetUI.resetRecurringExpenseUi(elements);
  }

  async function handleBudgetSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.budgetForm);
    const month = viewState.month;
    const result = window.BudgetTransactions.setMonthlyBudget(state, elements.budgetInput.valueAsNumber, month);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.budgetForm, elements.budgetMessage, result.errors);
      return;
    }
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.saveSettings(result.state),
      elements.budgetMessage,
      event.submitter
    );
    if (saved) {
      window.BudgetUI.setMessage(elements.budgetMessage, `${month} 예산을 저장했어요.`, 'ok');
    }
  }

  async function handleMonthStartSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.monthStartForm);
    const previousMonth = viewState.month;
    const previousSelectedDate = viewState.selectedDate;
    const result = window.BudgetTransactions.setMonthStartDay(state, elements.monthStartInput.valueAsNumber);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.monthStartForm, elements.monthStartMessage, result.errors);
      return;
    }

    viewState.month = window.BudgetStorage.monthKeyForDate(
      window.BudgetStorage.localDateString(),
      result.state.monthStartDay
    ) || window.BudgetStorage.localMonthString();
    viewState.selectedDate = '';
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.saveSettings(result.state),
      elements.monthStartMessage,
      event.submitter
    );
    if (!saved) {
      viewState.month = previousMonth;
      viewState.selectedDate = previousSelectedDate;
      render();
      return;
    }
    window.BudgetUI.setMessage(elements.monthStartMessage, '월 시작일을 저장했어요.', 'ok');
  }

  async function handleCategoryBudgetSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.categoryBudgetForm);
    const month = viewState.month;
    const inputBudgets = window.BudgetUI.readCategoryBudgetInputs(elements);
    const result = window.BudgetTransactions.setCategoryBudgets(state, inputBudgets, month);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.categoryBudgetForm, elements.categoryBudgetMessage, result.errors);
      return;
    }
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.saveSettings(result.state),
      elements.categoryBudgetMessage,
      event.submitter
    );
    if (saved) {
      window.BudgetUI.setMessage(elements.categoryBudgetMessage, `${month} 항목별 예산을 저장했어요.`, 'ok');
    }
  }

  async function handleTransactionSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.transactionForm);
    const input = {
      date: elements.dateInput.value,
      type: elements.typeSelect.value,
      category: elements.categorySelect.value,
      amount: elements.amountInput.value,
      memo: elements.memoInput.value
    };
    const result = window.BudgetTransactions.addTransaction(state, input);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.transactionForm, elements.formMessage, result.errors);
      return;
    }
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.insertTransaction(result.transaction),
      elements.formMessage,
      event.submitter
    );
    if (!saved) return;

    elements.transactionForm.reset();
    elements.dateInput.value = window.BudgetStorage.localDateString();
    elements.typeSelect.value = input.type;
    window.BudgetUI.fillCategoryOptions(elements.categorySelect, input.type);
    window.BudgetUI.setMessage(elements.formMessage, '거래를 추가했어요.', 'ok');
  }

  function handleTypeChange() {
    window.BudgetUI.fillCategoryOptions(elements.categorySelect, elements.typeSelect.value);
  }

  async function handleRecurringTemplateSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.recurringTemplateForm);
    const input = {
      memo: elements.recurringTemplateMemo.value,
      category: elements.recurringTemplateCategory.value,
      amount: elements.recurringTemplateAmount.value,
      dayOfMonth: elements.recurringTemplateDay.value
    };
    const wasEditing = Boolean(recurringTemplateEditId);
    const result = wasEditing
      ? window.BudgetTransactions.updateRecurringExpenseTemplate(state, recurringTemplateEditId, input)
      : window.BudgetTransactions.addRecurringExpenseTemplate(state, input);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(
        elements.recurringTemplateForm,
        elements.recurringTemplateMessage,
        result.errors
      );
      return;
    }

    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.saveSettings(result.state),
      elements.recurringTemplateMessage,
      event.submitter
    );
    if (!saved) return;

    recurringTemplateEditId = '';
    window.BudgetUI.clearRecurringTemplateEdit(elements, elements.recurringTemplateHeading);
    window.BudgetUI.setMessage(
      elements.recurringTemplateMessage,
      wasEditing ? '반복지출을 수정했어요.' : '반복지출을 등록했어요.',
      'ok'
    );
  }

  async function handleRecurringTemplateAction(event) {
    const button = event.target.closest('[data-action][data-template-id]');
    if (!button || button.disabled) return;
    const templateIndex = state.recurringExpenseTemplates.findIndex(
      (template) => template.id === button.dataset.templateId
    );
    if (templateIndex < 0) return;
    const template = state.recurringExpenseTemplates[templateIndex];

    if (button.dataset.action === 'edit-recurring-template') {
      recurringTemplateEditId = template.id;
      window.BudgetUI.beginRecurringTemplateEdit(elements, template, button);
      return;
    }
    if (button.dataset.action !== 'delete-recurring-template') return;
    if (!window.confirm(`${template.memo} 반복지출을 삭제할까요?`)) return;

    const nextState = window.BudgetTransactions.deleteRecurringExpenseTemplate(state, template.id);
    const saved = await persistRemoteFirst(
      nextState,
      () => window.BudgetCloud.saveSettings(nextState),
      elements.recurringTemplateMessage,
      button
    );
    if (!saved) return;

    recurringTemplateEditId = '';
    window.BudgetUI.clearRecurringTemplateEdit(elements, {
      reason: 'delete',
      deletedIndex: templateIndex
    });
    window.BudgetUI.setMessage(elements.recurringTemplateMessage, '반복지출을 삭제했어요.', 'ok');
  }

  function handleRecurringTemplateCancel(event) {
    event.preventDefault();
    if (mutationInFlight) {
      window.BudgetUI.setMessage(
        elements.recurringTemplateMessage,
        '저장 중이에요. 완료될 때까지 기다려 주세요.',
        'error'
      );
      elements.recurringTemplateMessage.focus();
      return;
    }
    recurringTemplateEditId = '';
    window.BudgetUI.clearRecurringTemplateEdit(elements);
  }

  function handleRecurringOccurrenceAction(event) {
    const button = event.target.closest(
      '[data-action="record-recurring-expense"][data-recurring-transaction-id]'
    );
    if (!button || button.disabled) return;
    const occurrence = recurringOccurrences.find(
      (item) => item.transactionId === button.dataset.recurringTransactionId
    );
    if (!occurrence) return;
    window.BudgetUI.openRecurringConfirmDialog(elements, occurrence, button);
  }

  async function handleRecurringConfirmSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.recurringConfirmForm);
    const transactionId = elements.recurringConfirmDialog.dataset.transactionId || '';
    const occurrence = recurringOccurrences.find((item) => item.transactionId === transactionId);
    const input = {
      date: elements.recurringConfirmDate.value,
      amount: elements.recurringConfirmAmount.value,
      category: elements.recurringConfirmCategory.value,
      memo: elements.recurringConfirmMemo.value
    };
    const result = window.BudgetTransactions.addRecurringExpenseTransaction(state, occurrence, input);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(
        elements.recurringConfirmForm,
        elements.recurringConfirmMessage,
        result.errors
      );
      return;
    }

    const movedOutsideSelectedMonth = !window.BudgetStorage.isDateInBudgetMonth(
      result.transaction.date,
      viewState.month,
      state.monthStartDay || 1
    );
    const mutation = await runExclusiveMutation(async () => {
      try {
        await window.BudgetCloud.insertTransaction(result.transaction);
        return { kind: 'created', state: result.state };
      } catch (error) {
        if (!window.BudgetCloud.isDuplicateTransactionError(error)) throw error;
        let latest;
        try {
          latest = await window.BudgetCloud.downloadState();
        } catch (downloadError) {
          const conflict = new Error('최신 클라우드 거래를 확인하지 못했어요. 다시 불러와 주세요.');
          conflict.code = '40001';
          throw conflict;
        }
        if (
          latest
          && Array.isArray(latest.transactions)
          && latest.transactions.some((transaction) => transaction.id === result.transaction.id)
        ) {
          return { kind: 'already-recorded', state: latest };
        }
        const conflict = new Error('클라우드 거래 상태가 달라졌어요. 다시 불러와 주세요.');
        conflict.code = '40001';
        throw conflict;
      }
    }, elements.recurringConfirmMessage, '반복지출 저장 실패');

    if (!mutation.ok) {
      if (!mutation.blocked) elements.recurringConfirmMessage.focus();
      return;
    }

    const outcome = mutation.value;
    state = window.BudgetStorage.saveState(outcome.state).state;
    render();
    window.BudgetUI.closeRecurringConfirmDialog(elements, { reason: 'saved' });
    const successMessage = outcome.kind === 'already-recorded'
      ? '이미 기록된 항목이에요. 최신 내용을 다시 불러와 주세요.'
      : movedOutsideSelectedMonth
        ? '기록했어요. 입력한 날짜가 현재 예산기간 밖이라 내역과 캘린더에는 보이지 않아요.'
        : '기록했어요.';
    setGlobalMessage(successMessage, 'ok');
  }

  function handleRecurringConfirmCancel(event) {
    event.preventDefault();
    if (mutationInFlight) {
      window.BudgetUI.setMessage(
        elements.recurringConfirmMessage,
        '저장 중이에요. 완료될 때까지 기다려 주세요.',
        'error'
      );
      elements.recurringConfirmMessage.focus();
      return;
    }
    window.BudgetUI.closeRecurringConfirmDialog(elements, { reason: 'cancel' });
  }

  function isCurrentRecurringTransaction(transaction) {
    const transactionId = String(transaction && transaction.id || '');
    const monthMatch = transactionId.match(/-(\d{4}-\d{2})$/);
    if (!monthMatch || !window.BudgetStorage.isValidMonthString(monthMatch[1])) return false;
    const scheduledMonth = monthMatch[1];
    const templates = window.BudgetStorage.normalizeRecurringExpenseTemplates(
      state.recurringExpenseTemplates
    );
    return templates.some((template) => {
      const scheduledDate = window.BudgetStorage.scheduledDateForMonth(
        scheduledMonth,
        template.dayOfMonth
      );
      return Boolean(
        scheduledDate
        && scheduledDate >= template.startsOn
        && window.BudgetTransactions.recurringTransactionId(template.id, scheduledMonth) === transactionId
      );
    });
  }

  async function handleTransactionAction(event) {
    const button = event.target.closest('[data-action][data-id]');
    if (!button) return;
    const transaction = state.transactions.find((item) => item.id === button.dataset.id);
    if (!transaction) return;

    if (button.dataset.action === 'edit') {
      window.BudgetUI.openEditDialog(elements, transaction, button);
      return;
    }
    if (button.dataset.action !== 'delete') return;

    const label = `${transaction.date} ${transaction.category} ${window.BudgetUI.formatWon(transaction.amount)}`;
    const recurringWarning = isCurrentRecurringTransaction(transaction)
      ? '\n삭제하면 해당 예정 항목이 다시 나타나요.'
      : '';
    if (!window.confirm(`${label} 내역을 삭제할까요?${recurringWarning}`)) return;
    const nextState = window.BudgetTransactions.deleteTransaction(state, transaction.id);
    const saved = await persistRemoteFirst(
      nextState,
      () => window.BudgetCloud.deleteTransaction(transaction.id, transaction),
      elements.globalMessage,
      button
    );
    if (saved) {
      window.BudgetUI.setMessage(elements.globalMessage, '거래를 삭제했어요.', 'ok');
    }
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.editForm);
    const expectedTransaction = state.transactions.find((item) => item.id === elements.editId.value);
    const result = window.BudgetTransactions.updateTransaction(state, elements.editId.value, {
      date: elements.editDate.value,
      type: elements.editType.value,
      category: elements.editCategory.value,
      amount: elements.editAmount.value,
      memo: elements.editMemo.value
    });
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.editForm, elements.editMessage, result.errors);
      return;
    }

    const movedOutsideSelectedMonth = !window.BudgetStorage.isDateInBudgetMonth(
      result.transaction.date,
      viewState.month,
      state.monthStartDay || 1
    );
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.updateTransaction(result.transaction, expectedTransaction),
      elements.globalMessage,
      elements.editSave
    );
    if (!saved) return;

    window.BudgetUI.closeEditDialog(elements);
    window.BudgetUI.setMessage(
      elements.globalMessage,
      movedOutsideSelectedMonth
        ? '수정했어요. 날짜가 바뀌어 현재 월 목록에서는 보이지 않아요.'
        : '거래를 수정했어요.',
      'ok'
    );
  }

  function changeMonth(delta) {
    viewState.month = window.BudgetStorage.addMonthsToMonth(viewState.month, delta);
    viewState.selectedDate = '';
    render();
  }

  function selectTab(tab, focus = false) {
    viewState.tab = tab;
    window.BudgetUI.setActiveTab(elements, tab, focus);
  }

  function handleTabKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = elements.tabs.indexOf(event.currentTarget);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? elements.tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + elements.tabs.length) % elements.tabs.length;
    selectTab(elements.tabs[nextIndex].dataset.tab, true);
  }

  async function handleSampleClick(event) {
    const month = viewState.month;
    const monthStartDay = state.monthStartDay || 1;
    const hasSample = window.BudgetTransactions.hasSampleForMonth(state.transactions, month, monthStartDay);
    if (hasSample && !window.confirm('선택한 달에 이미 샘플 데이터가 있어요. 기존 샘플만 교체할까요?')) return;

    const preparedState = window.BudgetTransactions.createSampleState(state, month, {
      replace: hasSample,
      monthStartDay
    });
    const saved = await replaceAllRemoteFirst(
      preparedState,
      elements.toolMessage,
      event.currentTarget,
      '샘플 저장 실패'
    );
    if (saved) {
      window.BudgetUI.setMessage(
        elements.toolMessage,
        hasSample ? '선택한 달의 샘플 데이터를 교체했어요.' : '선택한 달에 샘플 데이터를 추가했어요.',
        'ok'
      );
    }
  }

  function handleExportClick() {
    const filename = `beginner-budget-${window.BudgetStorage.localDateString()}.json`;
    window.BudgetUI.downloadText(filename, window.BudgetTransactions.exportState(state));
    window.BudgetUI.setMessage(elements.toolMessage, 'JSON 백업 파일을 내보냈어요.', 'ok');
  }

  function handleImportClick() {
    elements.importFile.setAttribute('aria-invalid', 'false');
    elements.importFile.click();
  }

  function showImportError(message) {
    elements.importFile.setAttribute('aria-invalid', 'true');
    window.BudgetUI.setMessage(elements.toolMessage, message, 'error');
    elements.importButton.focus();
  }

  function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showImportError('1MB 이하의 JSON 백업 파일만 가져올 수 있어요.');
      elements.importFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const result = window.BudgetTransactions.importState(String(reader.result || ''));
      if (!result.ok) {
        showImportError(result.errors.map((item) => item.message).join(' '));
        elements.importFile.value = '';
        return;
      }
      const summary = result.summary || {};
      const importedTransactionCount = Number.isInteger(summary.importedTransactionCount)
        ? summary.importedTransactionCount
        : Number(summary.importedCount) || 0;
      const skippedTransactionCount = Number.isInteger(summary.skippedTransactionCount)
        ? summary.skippedTransactionCount
        : Number(summary.skippedCount) || 0;
      const importedTemplateCount = Number.isInteger(summary.importedTemplateCount)
        ? summary.importedTemplateCount
        : 0;
      const skippedTemplateCount = Number.isInteger(summary.skippedTemplateCount)
        ? summary.skippedTemplateCount
        : 0;
      const confirmation = [
        `거래 ${importedTransactionCount}건과 반복지출 ${importedTemplateCount}건을 가져옵니다.`,
        `제외된 거래 ${skippedTransactionCount}건, 반복지출 ${skippedTemplateCount}건이 있어요.`,
        '현재 클라우드 데이터를 교체할까요?'
      ].join('\n');
      if (!window.confirm(confirmation)) {
        elements.importFile.value = '';
        return;
      }
      const saved = await replaceAllRemoteFirst(result.state, elements.toolMessage, elements.importButton);
      if (saved) {
        resetRecurringInteractionState();
        render();
        window.BudgetUI.setMessage(elements.toolMessage, 'JSON 데이터를 가져왔어요.', 'ok');
      }
      elements.importFile.value = '';
    };
    reader.onerror = () => {
      showImportError('파일을 읽지 못했어요.');
      elements.importFile.value = '';
    };
    reader.readAsText(file);
  }

  async function handleResetClick(event) {
    if (!window.confirm('모든 가계부 데이터를 삭제하고 기본 예산으로 되돌릴까요?')) return;
    const result = window.BudgetStorage.resetState();
    if (!result.ok) {
      window.BudgetUI.setMessage(elements.toolMessage, '초기화할 데이터를 준비하지 못했어요.', 'error');
      return;
    }
    const saved = await replaceAllRemoteFirst(result.state, elements.toolMessage, event.currentTarget);
    if (!saved) return;

    elements.categoryBudgetFields.innerHTML = '';
    window.BudgetUI.initDefaults(elements, state);
    viewState.month = currentBudgetMonth();
    viewState.selectedDate = '';
    resetRecurringInteractionState();
    render();
    window.BudgetUI.setMessage(elements.toolMessage, '전체 데이터를 초기화하고 Supabase에 저장했어요.', 'ok');
  }

  function applyDownloadedState(cloudState) {
    state = window.BudgetStorage.saveState(cloudState).state;
    viewState.month = currentBudgetMonth();
    viewState.selectedDate = '';
    resetRecurringInteractionState();
    render();
  }

  async function loadCloudStateForSignedInUser() {
    let user;
    try {
      user = await window.BudgetCloud.currentUser();
    } catch (error) {
      setCloudReadiness('signed-out', null);
      window.BudgetUI.setMessage(elements.cloudMessage, `로그인 상태 확인 실패: ${error.message}`, 'error');
      return false;
    }
    if (!user) {
      setCloudReadiness('signed-out', null);
      return false;
    }

    setCloudReadiness('loading', user);
    try {
      const cloudState = await window.BudgetCloud.downloadState();
      applyDownloadedState(cloudState);
      setCloudReadiness('ready', user);
      clearMutationMessages();
      window.BudgetUI.setMessage(elements.cloudMessage, '클라우드 데이터를 불러왔어요.', 'ok');
      return true;
    } catch (error) {
      setCloudReadiness('load-error', user);
      window.BudgetUI.setMessage(elements.cloudMessage, `클라우드 데이터를 불러오지 못했어요: ${error.message}`, 'error');
      return false;
    }
  }

  async function handleCloudLogin(event) {
    event.preventDefault();
    const password = elements.cloudPassword.value;
    if (!password) {
      window.BudgetUI.setMessage(elements.cloudMessage, '비밀번호를 입력해 주세요.', 'error');
      elements.cloudPassword.focus();
      return;
    }
    try {
      await window.BudgetCloud.signInWithPassword(password);
    } catch (error) {
      setCloudReadiness('signed-out', null);
      window.BudgetUI.setMessage(elements.cloudMessage, `로그인 실패: ${error.message}`, 'error');
      elements.cloudPassword.focus();
      return;
    }

    elements.cloudPassword.value = '';
    let user = { id: 'signed-in' };
    setCloudReadiness('loading', user);
    try {
      const currentUser = await window.BudgetCloud.currentUser();
      if (!currentUser) throw new Error('로그인 정보를 확인하지 못했어요.');
      user = currentUser;
      setCloudReadiness('loading', user);
      const cloudState = await window.BudgetCloud.downloadState();
      applyDownloadedState(cloudState);
      setCloudReadiness('ready', user);
      window.BudgetUI.setMessage(elements.cloudMessage, '로그인하고 클라우드 데이터를 불러왔어요.', 'ok');
    } catch (error) {
      setCloudReadiness('load-error', user);
      window.BudgetUI.setMessage(
        elements.cloudMessage,
        `로그인은 됐지만 클라우드 데이터를 불러오지 못했어요: ${error.message}`,
        'error'
      );
    }
  }

  async function handleCloudUpload(event) {
    const operation = await runExclusiveMutation(
      () => window.BudgetCloud.uploadState(state, state),
      elements.cloudMessage,
      '클라우드 저장 실패'
    );
    if (operation.ok) {
      window.BudgetUI.setMessage(
        elements.cloudMessage,
        `클라우드에 저장했어요. 거래 ${operation.value.uploadedCount}건`,
        'ok'
      );
    }
  }

  async function handleCloudDownload(event) {
    if (mutationInFlight) {
      setGlobalMessage('저장 작업이 진행 중이라 지금은 클라우드 데이터를 불러올 수 없어요.', 'error');
      return;
    }
    if (!signedInUser || !['ready', 'load-error'].includes(cloudReadiness)) {
      setGlobalMessage('클라우드 데이터 불러오기를 시작할 수 없는 상태예요.', 'error');
      return;
    }
    if (!window.confirm('현재 화면을 최신 클라우드 데이터로 다시 불러올까요?')) return;
    const user = signedInUser;
    setCloudReadiness('loading', user);
    try {
      const cloudState = await window.BudgetCloud.downloadState();
      applyDownloadedState(cloudState);
      setCloudReadiness('ready', user);
      clearMutationMessages();
      window.BudgetUI.setMessage(elements.cloudMessage, '클라우드 데이터를 불러왔어요.', 'ok');
    } catch (error) {
      setCloudReadiness('load-error', user);
      window.BudgetUI.setMessage(elements.cloudMessage, `클라우드 데이터를 불러오지 못했어요: ${error.message}`, 'error');
    }
  }

  async function handleCloudLogout(event) {
    if (mutationInFlight) {
      setGlobalMessage('저장 작업이 진행 중이라 지금은 로그아웃할 수 없어요.', 'error');
      return;
    }
    if (!signedInUser || !['ready', 'load-error'].includes(cloudReadiness)) {
      setGlobalMessage('지금은 로그아웃을 시작할 수 없는 상태예요.', 'error');
      return;
    }
    const previousReadiness = cloudReadiness;
    const previousUser = signedInUser;
    setCloudReadiness('loading', previousUser);
    try {
      await window.BudgetCloud.signOut();
    } catch (error) {
      setCloudReadiness(previousReadiness, previousUser);
      window.BudgetUI.setMessage(elements.cloudMessage, `로그아웃 실패: ${error.message}`, 'error');
      return;
    }

    resetRecurringInteractionState();
    state = window.BudgetStorage.defaultState();
    viewState.tab = 'home';
    viewState.selectedDate = '';
    elements.filterType.value = 'all';
    window.BudgetUI.fillFilterCategoryOptions(elements.filterCategory, 'all', 'all');
    elements.filterQuery.value = '';
    elements.typeSelect.value = 'expense';
    elements.amountInput.value = '';
    elements.memoInput.value = '';
    elements.editId.value = '';
    elements.editDate.value = '';
    elements.editAmount.value = '';
    elements.editMemo.value = '';
    if (elements.editDialog.open) window.BudgetUI.closeEditDialog(elements);
    elements.categoryBudgetFields.innerHTML = '';
    window.BudgetUI.initDefaults(elements, state);
    window.BudgetUI.resetRecurringExpenseUi(elements);
    viewState.month = currentBudgetMonth();
    clearMutationMessages();
    setCloudReadiness('signed-out', null);
    render();
    window.BudgetUI.setMessage(elements.cloudMessage, '로그아웃했어요.', 'ok');
    elements.cloudPassword.value = '';
    elements.cloudPassword.focus();
  }

  function bindEvents() {
    elements.tabs.forEach((tab) => {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
      tab.addEventListener('keydown', handleTabKeydown);
    });
    elements.previousMonthButton.addEventListener('click', () => changeMonth(-1));
    elements.nextMonthButton.addEventListener('click', () => changeMonth(1));
    elements.currentMonthButton.addEventListener('click', () => {
      viewState.month = currentBudgetMonth();
      viewState.selectedDate = '';
      render();
    });
    elements.monthInput.addEventListener('change', () => {
      if (!window.BudgetStorage.isValidMonthString(elements.monthInput.value)) {
        elements.monthInput.value = viewState.month;
        return;
      }
      viewState.month = elements.monthInput.value;
      viewState.selectedDate = '';
      render();
    });
    elements.filterType.addEventListener('change', () => {
      window.BudgetUI.fillFilterCategoryOptions(elements.filterCategory, elements.filterType.value, 'all');
      render();
    });
    elements.filterCategory.addEventListener('change', render);
    elements.filterQuery.addEventListener('input', render);

    elements.monthStartForm.addEventListener('submit', handleMonthStartSubmit);
    elements.budgetForm.addEventListener('submit', handleBudgetSubmit);
    elements.categoryBudgetForm.addEventListener('submit', handleCategoryBudgetSubmit);
    elements.transactionForm.addEventListener('submit', handleTransactionSubmit);
    elements.recurringTemplateForm.addEventListener('submit', handleRecurringTemplateSubmit);
    elements.recurringTemplateList.addEventListener('click', handleRecurringTemplateAction);
    elements.recurringTemplateCancel.addEventListener('click', handleRecurringTemplateCancel);
    elements.recurringUpcomingList.addEventListener('click', handleRecurringOccurrenceAction);
    elements.recurringConfirmForm.addEventListener('submit', handleRecurringConfirmSubmit);
    elements.recurringConfirmCancel.addEventListener('click', handleRecurringConfirmCancel);
    elements.recurringConfirmDialog.addEventListener('cancel', handleRecurringConfirmCancel);
    elements.typeSelect.addEventListener('change', handleTypeChange);
    elements.list.addEventListener('click', handleTransactionAction);
    elements.calendarDetailList.addEventListener('click', handleTransactionAction);
    elements.calendarGrid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="select-date"]');
      if (!button || button.disabled) return;
      viewState.selectedDate = button.dataset.date;
      render();
    });

    elements.editForm.addEventListener('submit', handleEditSubmit);
    elements.editType.addEventListener('change', () => {
      window.BudgetUI.fillCategoryOptions(elements.editCategory, elements.editType.value);
    });
    [elements.editClose, elements.editCancel].forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        window.BudgetUI.closeEditDialog(elements);
      });
    });
    elements.editDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      window.BudgetUI.closeEditDialog(elements);
    });

    elements.sampleButton.addEventListener('click', handleSampleClick);
    elements.exportButton.addEventListener('click', handleExportClick);
    elements.importButton.addEventListener('click', handleImportClick);
    elements.importFile.addEventListener('change', handleImportFile);
    elements.resetButton.addEventListener('click', handleResetClick);
    elements.cloudLoginForm.addEventListener('submit', handleCloudLogin);
    elements.cloudUploadButton.addEventListener('click', handleCloudUpload);
    elements.cloudDownloadButton.addEventListener('click', handleCloudDownload);
    elements.cloudLogoutButton.addEventListener('click', handleCloudLogout);
    elements.transactionForm.addEventListener('reset', () => {
      window.setTimeout(() => {
        elements.dateInput.value = window.BudgetStorage.localDateString();
        window.BudgetUI.fillCategoryOptions(elements.categorySelect, elements.typeSelect.value);
        window.BudgetUI.clearFieldErrors(elements.transactionForm);
        window.BudgetUI.setMessage(elements.formMessage, '', null);
      }, 0);
    });
  }

  async function init() {
    elements = window.BudgetUI.getElements();
    window.BudgetUI.initDefaults(elements, state);
    viewState.month = currentBudgetMonth();
    window.BudgetUI.fillFilterCategoryOptions(elements.filterCategory, 'all', 'all');
    const previewEnvironment = Boolean(
      window.BudgetCloud.ENVIRONMENT && window.BudgetCloud.ENVIRONMENT.isPreview
    );
    elements.previewDataWarning.hidden = !previewEnvironment;
    document.body.classList.toggle('has-preview-warning', previewEnvironment);
    setCloudReadiness('loading', null);
    bindEvents();
    render();
    await loadCloudStateForSignedInUser();
  }

  document.addEventListener('DOMContentLoaded', init);
})(window, document);
