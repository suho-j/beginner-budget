(function(window) {
  'use strict';
  // KASI 2026 calendar: https://www.kasi.re.kr/kor/post/newsMaterial/32031
  // May 1 is included as a bank non-business day. No silent lunar extrapolation.
  const holidays = new Set(['2026-01-01','2026-02-16','2026-02-17','2026-02-18',
    '2026-03-01','2026-03-02','2026-05-01','2026-05-05','2026-05-24','2026-05-25',
    '2026-06-03','2026-06-06','2026-08-15','2026-08-17','2026-09-24','2026-09-25',
    '2026-09-26','2026-10-03','2026-10-05','2026-10-09','2026-12-25','2027-01-01']);
  const iso = d => d.toISOString().slice(0,10);
  function dateFor(month, schedule) {
    if (!/^\d{4}-\d{2}$/.test(month) || !schedule?.day) return null;
    const [y,m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y,m,0)).getUTCDate();
    const day = schedule.day === 'last' ? last : Math.min(Number(schedule.day),last);
    const date = new Date(Date.UTC(y,m-1,day));
    if (schedule.rule !== 'none') {
      const step = schedule.rule === 'previous' ? -1 : 1;
      while ([0,6].includes(date.getUTCDay()) || holidays.has(iso(date))) date.setUTCDate(date.getUTCDate()+step);
    }
    return iso(date);
  }
  function events(plans,month) {
    const dated=[], undated=[], shifted=[];
    for (const planMonth of [window.BudgetStorage.addMonthsToMonth(month,-1),month,window.BudgetStorage.addMonthsToMonth(month,1)]) {
      for (const item of plans[planMonth]?.items || []) {
        const date=dateFor(planMonth,item.schedule);
        const event={...item,date,planMonth};
        if (!date && planMonth===month) undated.push(event);
        else if (date?.startsWith(month)) dated.push(event);
        else if (date && planMonth===month) shifted.push(event);
      }
    }
    dated.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'ko'));
    return {dated,undated,shifted};
  }
  window.BudgetCashflowSchedule={dateFor,events,holidays};
})(window);
