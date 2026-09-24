import { EnvironmentProviders, Injectable } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { UiMap } from '@creativo/ui/controls';
import { UiCodeScanner } from '@creativo/ui/patterns';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffTimeGrid } from '../time-grid/staff-time-grid';
import {
  type VisitEditorPhoto,
  StaffVisitEditor,
  type VisitEditorServiceOption,
  type VisitEditorShopOption,
  type VisitEditorClientSection,
  type VisitEditorVm,
  parsePriceInput,
} from './staff-visit-editor';

/**
 * The editor's own behaviour — the ladder, the one-level page stack, the
 * derived end time and the note reveal.
 *
 * Every one of these is a property of THIS component rather than of the day
 * it was opened from, so they are exercised against a literal VM: a failure
 * here is a bug in the sheet, never a bug in a store that fed it.
 */

/**
 * Only the strings the assertions read back.
 *
 * Flat keys, deliberately: the assertions below are about the SHAPE the
 * copy takes — `45 мин · до 10:45` is a duration and the end it yields on
 * one line — and a test that asserts against `staff.visit.durationOption`
 * would pass while the interpolation was broken.
 */
@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({
      'staff.visit.title': 'Час',
      'staff.visit.day': 'Ден',
      'staff.visit.start': 'Начало',
      'staff.visit.duration': 'Времетраене',
      'staff.visit.durationOption': '{{minutes}} мин · до {{end}}',
      'staff.visit.minutes': '{{minutes}} мин',
      'staff.visit.services': 'Услуги',
      'staff.visit.barbers': 'Бръснари',
      'staff.visit.service': 'Услуга',
      'staff.visit.addService': 'Добави услуга',
      'staff.visit.serviceMore': 'Още една',
      'staff.visit.serviceLess': 'Махни една',
      'staff.visit.servicesAddOne': 'Добави',
      'staff.visit.servicesAddCount': 'Добави {{count}} услуги',
      'staff.visit.removeService': 'Премахни услугата',
      'staff.visit.addClient': 'Добави клиент',
      'staff.visit.addNote': 'Добави бележка',
      'staff.visit.teamNote': 'Бележка за екипа',
      'staff.visit.notePlaceholder':
        'Напр. предпочитания, алергии, напомняния…',
      'staff.visit.money': 'Пари',
      'staff.visit.tip': 'Бакшиш',
      'staff.visit.shop': 'Салон',
      'staff.visit.shopUnknown': '—',
      'staff.visit.shopView': 'Изглед',
      'staff.visit.shopMap': 'Карта',
      'staff.visit.shopList': 'Списък',
      'staff.visit.chooseService': 'Избери услуга',
      'staff.visit.newTitle': 'Нов час',
      'staff.visit.byCatalogue': 'По каталог',
      'staff.day.visitNoPhone': 'Няма номер',
      'staff.visit.tipNone': 'Без',
      'staff.visit.tipRoundUp': 'общо {{total}}',
      'staff.visit.tipPageAmount': 'Друга сума',
      'staff.visit.tipStepDown': 'Намали',
      'staff.visit.tipStepUp': 'Увеличи',
      'staff.visit.tipPageDescription': 'Оставен от клиента',
      'staff.visit.frameExpand': 'На цял екран',
      'staff.visit.frameCollapse': 'Изход от цял екран',
      'staff.visit.tipInDock': '+{{amount}} бакшиш',
      'staff.visit.discount': 'Отстъпка',
      'staff.visit.discountNone': 'Няма',
      'staff.visit.photos': 'Снимки',
      'staff.visit.addPhoto': 'Добави снимка',
      'staff.visit.photoTake': 'Снимай',
      'staff.visit.photoUpload': 'От устройството',
      'staff.visit.photoMenu': 'Добавяне на снимка',
      'staff.visit.photoSystem': 'От галерията',
      'staff.visit.photoSystemHint': 'Снимки от каталога и работата на салона.',
      'staff.visit.photoSystemEmpty': 'Още няма снимки в галерията.',
      'staff.visit.cameraStarting': 'Камерата се включва…',
      'staff.visit.cameraReady': 'Насочи и снимай.',
      'staff.visit.cameraDenied': 'Няма достъп до камерата.',
      'staff.visit.cameraUnsupported':
        'Тук няма камера — качи снимка от телефона.',
      'staff.visit.photoShutter': 'Снимай',
      'staff.visit.photosSelected': 'Избрани',
      'staff.visit.photosAdd': 'Добави',
      'staff.visit.photo': 'Снимка',
      'staff.visit.photoTakenAt': 'Снимано',
      'staff.visit.photoChair': 'Бръснар',
      'staff.visit.photoClient': 'Клиент',
      'staff.visit.photoRemove': 'Изтрий снимката',
      'staff.visit.photoOpen': 'Снимка от {{when}}',
      'staff.visit.appliedRow': 'Приложени',
      'staff.visit.discountCount': '{{count}} отстъпки',
      'staff.visit.discountApplied': '{{count}} приложени',
      'staff.visit.addDiscount': 'Добави отстъпка',
      'staff.visit.discountHasGrant': 'Има купон: {{label}}',
      'staff.visit.couponBlocked': 'Не се комбинира',
      'staff.visit.applyDiscount': 'Приложи {{what}}',
      'staff.visit.applyGrant': 'Приложи купона',
      'staff.visit.kindGrant': 'Купон на клиента',
      'staff.visit.discountKind': 'Вид',
      'staff.visit.kindCoupon': 'Ваучер / Купон',
      'staff.visit.kindCouponDetail':
        'Код от ваучер или купон — въведен или сканиран',
      'staff.visit.kindPromoDetail': 'Кодовете на салона',
      'staff.visit.scan': 'Сканирай',
      'staff.visit.scanTitle': 'Сканирай код',
      'staff.visit.scanHint': 'Насочи камерата към QR кода или баркода',
      'staff.visit.scanStarting': 'Пускам камерата…',
      'staff.visit.scanScanning': 'Търся код…',
      'staff.visit.scanDenied': 'Няма достъп до камерата. Въведи кода на ръка.',
      'staff.visit.scanUnsupported':
        'Това устройство не сканира. Въведи кода на ръка.',
      'staff.visit.scanTypeInstead': 'Въведи на ръка',
      'staff.visit.remove': 'Премахни',
      'staff.visit.kindPromo': 'Промо код',
      'staff.visit.useNow': 'Използвай',
      'staff.visit.voucherCodePlaceholder': 'напр. GIFT2025',
      'staff.visit.stacks': 'комбинира се',
      'staff.visit.alone': 'само този',
      'staff.visit.discountScope': 'Отстъпка за целия час',
      'staff.visit.discountAmount': 'Сума',
      'staff.visit.discountPercent': 'Процент',
      'staff.visit.discountUnknownCode': 'Няма такъв код.',
      'staff.visit.discountChecking': 'Проверявам…',
      'staff.visit.discountFree': 'Безплатно',
      'staff.visit.removeDiscount': 'Премахни отстъпката',
      'staff.visit.voucher': 'Ваучер',
      'staff.visit.voucherLeft': 'остават {{amount}}',
      'staff.visit.removeVoucher': 'Премахни ваучера',
      'staff.visit.voucherEmpty': 'Ваучерът е изчерпан.',
      'staff.visit.voucherExpired': 'Ваучерът е изтекъл.',
      'staff.visit.voucherVoid': 'Ваучерът е анулиран.',
      'staff.visit.voucherNothingLeft': 'Няма какво да покрие.',
      'staff.visit.codeAlready': 'Вече е добавен.',
      'staff.visit.currencySymbol': '€',
      'staff.visit.atShop': 'В салона',
      'staff.visit.addPromo': 'Добави промоция',
      'staff.visit.addTip': 'Добави бакшиш',
      'staff.visit.forWhom': 'За кого',
      'staff.visit.variant': 'Вариант',
      'staff.visit.catalogMinutes': 'Каталог: {{minutes}} мин',
      'staff.visit.catalogPrice': 'Каталог: {{price}}',
      'staff.visit.seated': 'Добавена',
      'staff.visit.confirm': 'Потвърди',
      'staff.visit.peopleCount': 'Клиенти: {{count}}',
      'staff.visit.walkIn': 'Случаен клиент',
      'staff.visit.newClient': 'Нов клиент',
      'staff.visit.exactMatch': 'Вече е клиент',
      'staff.visit.newClientParts': 'Нов клиент: {{parts}}',
      'staff.visit.clientsRecent': 'Скорошни',
      'staff.visit.searchHint':
        'Търси по име или телефон — или създай нов клиент.',
      'staff.visit.onVisit': 'На посещението',
      'staff.visit.newClientTitle': 'Нов клиент',
      'staff.visit.clientName': 'Име',
      'staff.visit.clientPhone': 'Телефон',
      'staff.visit.clientEmail': 'Имейл',
      'staff.visit.addPerson': 'Добави клиента',
      'staff.visit.end': 'Край',
      'staff.visit.timingMode': 'Времетраене или край',
      'staff.visit.servicesFor': 'За {{name}}',
      'staff.visit.removeClient': 'Махни',
      'staff.visit.cancelFor': 'Откажи за {{names}}',
      'staff.visit.clientNoteFrom': 'От клиента',
      'staff.visit.notSavedYet': 'Още не се записва.',
      'staff.visit.custom': 'по договорка',
      'staff.visit.rebook': 'Запиши пак',
      'staff.visit.confirmRequest': 'Потвърди заявката',
      'staff.visit.requestLine': 'Клиентът чака отговор',
      'staff.visit.exits': 'Отказ или неявяване',
      'staff.visit.cancelVisit': 'Откажи часа',
      'staff.visit.cancelAndBlock': 'Откажи и блокирай времето',
      'staff.day.statusArrived': 'Дошъл',
      'staff.visit.back': 'Назад',
      'staff.day.cancelDismiss': 'Затвори',
      'staff.day.moreActions': 'Още действия',
      'staff.day.visitCall': 'Обади се',
    });
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/** One 10:00–10:45 visit in Иван's chair: a 30-minute cut and a 15-minute beard. */
function visit(partial: Partial<VisitEditorVm> = {}): VisitEditorVm {
  return {
    appointmentId: 'appointment-1',
    rowId: 'appointment-1#ivan',
    // The Center's — the seed's first shop; the shop test hands the sheet two.
    locationId: 'loc-center',
    // An ordinary one-person visit: nobody else is in this booking, so the
    // peer run does not render. The party case has its own test.
    peers: [],
    // Regime A — the status verbs write today, through a callable that
    // ships. They are not part of the draft.
    primaryVerb: { kind: 'arrived', label: 'Дойде', destructive: false },
    overflowVerbs: [],
    acting: false,
    dayKey: '2026-08-26',
    todayKey: '2026-08-26',
    /*
     * ⚠ EXACTLY what `dayLabelFor` produces for `dayKey`, and it was not.
     *
     * The VM's label comes from the parent's formatter and the draft's from
     * the editor's own — the twinning already flagged on both functions — so
     * a fixture whose label disagrees with its key makes the sheet dirty the
     * moment a day is stepped away and back. It also said `вт` for a date
     * that is a Wednesday, which no formatter would ever have written.
     */
    dayLabel: 'ср, 26.08',
    startMinute: 600,
    endMinute: 645,
    legs: [
      {
        seatId: 'seat-cut',
        serviceId: 'cut',
        variantId: null,
        serviceLabel: 'Класическо подстригване',
        minutes: 30,
        priceLabel: '20,00 €',
        barberId: 'ivan',
        barberName: 'Иван',
        barberTone: 0,
        overridden: false,
      },
      {
        seatId: 'seat-beard',
        serviceId: 'beard',
        variantId: null,
        serviceLabel: 'Оформяне на брада',
        minutes: 15,
        priceLabel: '8,00 €',
        barberId: 'niko',
        barberName: 'Нико',
        barberTone: 1,
        overridden: false,
      },
    ],
    clientLabel: 'Мартин Илиев',
    clientUserId: 'user-martin',
    phone: '+359 88 123 4567',
    phoneHref: '+359881234567',
    clientMeta: 'Нов',
    note: 'Закъснявам 5 минути.',
    teamNote: null,
    priceLabel: '28,00 €',
    priceMinorUnits: 2800,
    // Nothing recorded — NOT zero, which is why the sheet offers an add-row
    // rather than a field reading `0,00 €`.
    tipLabel: null,
    tipMinorUnits: null,
    // Full price, nothing paid ahead — the bill's ladder holds only the seats.
    discounts: [],
    vouchers: [],
    // Live — nothing has settled it, so the head has nothing to say.
    resolution: null,
    status: 'confirmed',
    statusLabel: 'Потвърден',
    arrivedMinute: null,
    chairId: 'ivan',
    chairName: 'Иван',
    chairTone: 0,
    neighbours: [{ name: 'Мартин', startMinute: 540, endMinute: 590, tone: 2 }],
    rosterStartMinute: 540,
    rosterEndMinute: 1080,
    nowMinute: null,
    ...partial,
  };
}

/*
 * More than one row, deliberately: with a single service the quick-add menu
 * and the search page below it were indistinguishable from each other, and
 * "the query does not shorten the menu" could not tell a filtered list from
 * an unfiltered one.
 */
const CATALOGUE: readonly VisitEditorServiceOption[] = [
  {
    id: 'cut:short',
    serviceId: 'cut',
    variantId: 'short',
    variantLabel: 'Къса коса',
    label: 'Подстригване · Къса коса',
    serviceLabel: 'Подстригване',
    minutes: 30,
    priceLabel: '20,00 €',
  },
  {
    id: 'cut:long',
    serviceId: 'cut',
    variantId: 'long',
    variantLabel: 'Дълга коса',
    label: 'Подстригване · Дълга коса',
    serviceLabel: 'Подстригване',
    minutes: 45,
    priceLabel: '24,00 €',
  },
  {
    id: 'wash',
    serviceId: 'wash',
    variantId: null,
    label: 'Измиване',
    minutes: 10,
    priceLabel: '5,00 €',
  },
  {
    id: 'fade',
    serviceId: 'fade',
    variantId: null,
    label: 'Фейд',
    minutes: 45,
    priceLabel: '28,00 €',
  },
  {
    id: 'beard',
    serviceId: 'beard',
    variantId: null,
    label: 'Оформяне на брада',
    minutes: 15,
    priceLabel: '8,00 €',
  },
];

describe('parsePriceInput', () => {
  it('reads what a keypad and a formatted label both produce', () => {
    expect(parsePriceInput('18')).toBe(1800);
    expect(parsePriceInput('18,5')).toBe(1850);
    expect(parsePriceInput('18.50')).toBe(1850);
    expect(parsePriceInput('1.234,50')).toBe(123450);
    expect(parsePriceInput(' 28,00 € ')).toBe(2800);
    expect(parsePriceInput('0')).toBe(0);
  });

  it('refuses what is not money', () => {
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('free')).toBeNull();
    expect(parsePriceInput('1,234')).toBeNull();
    expect(parsePriceInput('€')).toBeNull();
  });
});

describe('StaffVisitEditor', () => {
  let fixture: ComponentFixture<StaffVisitEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StaffVisitEditor],
      providers: [...provideTestI18n()],
    }).compileComponents();
    fixture = TestBed.createComponent(StaffVisitEditor);
  });

  function render(vm: VisitEditorVm = visit()): HTMLElement {
    fixture.componentRef.setInput('vm', vm);
    fixture.componentRef.setInput('uiServices', CATALOGUE);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const find = (host: HTMLElement, testId: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  /**
   * A node's words, with the icon ligatures taken out.
   *
   * `ui-icon` renders its glyph as TEXT (a material-symbols ligature), so a
   * row's `textContent` carries `arrow_drop_down` beside the value. Reading
   * around it keeps the assertions about copy rather than about glyphs.
   */
  const text = (host: HTMLElement, testId: string) => {
    const node = find(host, testId)?.cloneNode(true) as HTMLElement | undefined;
    node?.querySelectorAll('ui-icon').forEach((icon) => icon.remove());
    return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  };

  const click = (host: HTMLElement, testId: string) => {
    find(host, testId)?.click();
    fixture.detectChanges();
  };

  /**
   * A pick inside the OPEN menu. Every ladder row carries the same choice
   * menus, so an option's test id appears once per row; only the open
   * surface holds the one that means this row.
   */
  const pickOpen = (host: HTMLElement, testId: string) => {
    host
      .querySelector<HTMLElement>(
        `ui-menu[data-open] [data-testid="${testId}"]`,
      )
      ?.click();
    fixture.detectChanges();
  };

  /** The way back lives in the sheet shell's bar; here it is the public call. */
  const back = () => {
    fixture.componentInstance.pop();
    fixture.detectChanges();
  };

  /**
   * ⚠ REGRESSION. The frame's drag copy must reach the grid UNTRANSPILED.
   *
   * The grid fills `{{minutes}}` itself, once per pointer move. Sourcing that
   * string with `translate('staff.visit.minutes', { minutes: '{{minutes}}' })`
   * — passing the placeholder as its own value — makes Transloco substitute
   * the hole with itself and rescan the result forever. It is a synchronous
   * infinite loop inside `afterNextRender`, so the tab wedges with no error
   * and this suite hangs rather than fails. Asserting the RAW template is
   * what pins it: `translate()` cannot return this string by any argument.
   */
  /** The grid the frame draws into, for assertions about what it was handed. */
  function frameGrid(): StaffTimeGrid {
    const found = fixture.debugElement.query(By.directive(StaffTimeGrid));
    expect(found).not.toBeNull();
    return found.componentInstance as StaffTimeGrid;
  }

  /**
   * ⚠ The frame draws the WHOLE CIVIL DAY (owner ruling 2026-08-26).
   *
   * A hundred minutes was not merely a small view — the grid DROPS what falls
   * outside the window, so the afternoon was not in the frame at all and no
   * amount of scrolling or dragging could reach it. Widening it to the roster
   * plus a margin had the same shape one size larger. Midnight to midnight is
   * a constant, so it can never disagree with the roster and has no fallback
   * to get wrong; the shift is drawn INSIDE it as shaded closed hours.
   */
  it('hands the frame the whole civil day, whatever the roster says', () => {
    render();
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });

    // The roster is 09:00–18:00 in the fixture and does not narrow it…
    render(visit({ rosterStartMinute: 540, rosterEndMinute: 1080 }));
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });

    // …nor does a visit that starts before the shift, nor an unreadable one.
    render(visit({ startMinute: 60, endMinute: 105 }));
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });
  });

  it('does not draw the day shut when the roster reads across midnight', () => {
    // A chair rostered 14:00–00:00 arrives as 840 → 0, because the dashboard
    // reads that end as a wall-clock minute without anchoring it to the day.
    // Handed to the grid raw, an inverted window is DROPPED by `closedRuns`
    // and the whole frame paints as shut hours — under a visit sitting
    // squarely inside the shift.
    render(
      visit({
        rosterStartMinute: 840,
        rosterEndMinute: 0,
        startMinute: 900,
        endMinute: 945,
      }),
    );

    expect(frameGrid().columns()[0]?.open).toEqual([
      { startMinute: 0, endMinute: 1440 },
    ]);
  });

  /**
   * The barbers are participants, and two legs worked by one barber are ONE
   * participant — a visit is a list of legs, so the naive render says his
   * name once per service.
   */
  it('names each barber once, as one row, with no service on it', () => {
    const host = render(
      visit({
        legs: [
          {
            seatId: 'a',
            serviceLabel: 'Подстригване',
            minutes: 30,
            priceLabel: '20,00 €',
            barberId: 'ivan',
            barberName: 'Иван',
            barberTone: 0,
          },
          {
            seatId: 'b',
            serviceLabel: 'Брада',
            minutes: 15,
            priceLabel: '8,00 €',
            barberId: 'ivan',
            barberName: 'Иван',
            barberTone: 0,
          },
        ],
      }),
    );

    // ONE row, not one per leg — and NO service on it: the ladder's own
    // services section says that a few rows down, and a participant that
    // repeats it says the same thing twice.
    expect(
      host.querySelectorAll('[data-testid="staff-visit-barber-ivan"]'),
    ).toHaveLength(1);
    // `И Иван` — the avatar's monogram rides in the row's own text.
    expect(text(host, 'staff-visit-barber-ivan')).toContain('Иван');
    expect(text(host, 'staff-visit-barber-ivan')).not.toContain('Подстригване');
  });

  /**
   * The barber picker is the SAME `ui-menu` the view toolbar's scope switcher
   * uses — portrait, tone badge, name, a check on the current one.
   *
   * ONE MENU PER ROW is what makes a split visit unambiguous: the menu on
   * Иван's row re-chairs Иван's legs and leaves Нико's alone. A single field
   * for the whole visit had to guess whose legs a pick meant.
   */
  it('hands the frame to the chair the visit was moved to', () => {
    // Owner, 2026-09-09: switching the barber must switch the frame to that
    // barber's day. The sheet reports its chair; the frame names it.
    fixture.componentRef.setInput('uiBarbers', [
      { id: 'ivan', label: 'Иван', tone: 0, avatarSrc: null },
      { id: 'stefan', label: 'Стефан', tone: 2, avatarSrc: null },
    ]);
    const host = render();
    const chairs: string[] = [];
    fixture.componentInstance.chairChanged.subscribe((id) => chairs.push(id));
    click(host, 'staff-visit-barber-ivan');
    click(host, 'staff-visit-barber-pick-stefan');
    expect(chairs.at(-1)).toBe('stefan');
    expect(text(host, 'staff-visit-frame-summary')).toContain('Стефан');
  });

  it('re-chairs from a menu, and only the row it was opened from', () => {
    fixture.componentRef.setInput('uiBarbers', [
      { id: 'ivan', label: 'Иван', tone: 0, avatarSrc: '/ivan.jpg' },
      { id: 'niko', label: 'Нико', tone: 1, avatarSrc: null },
      { id: 'stefan', label: 'Стефан', tone: 2, avatarSrc: null },
    ]);
    const host = render();

    // ⚠ THE PORTRAIT. `ui-avatar` falls back to a monogram whenever `uiSrc`
    // is absent, so a missing src does not fail — it quietly draws initials,
    // which is exactly how every barber here ended up wearing them.
    const face = find(host, 'staff-visit-barber-ivan')?.querySelector(
      'ui-avatar img, ui-avatar ui-async-image',
    );
    expect(face).not.toBeNull();

    // The whole roster is offered, with a check against the current chair.
    click(host, 'staff-visit-barber-ivan');
    fixture.detectChanges();
    expect(
      host.querySelectorAll('[role="menuitemradio"]').length,
    ).toBeGreaterThan(2);

    click(host, 'staff-visit-barber-pick-stefan');
    fixture.detectChanges();

    expect(text(host, 'staff-visit-barber-stefan')).toContain('Стефан');
    expect(
      host.querySelector('[data-testid="staff-visit-barber-ivan"]'),
    ).toBeNull();
    // Нико's leg is untouched — the menu re-chaired the row it belongs to.
    expect(text(host, 'staff-visit-barber-niko')).toContain('Нико');
  });

  it('hands the frame the whole civil day, whatever the roster says', () => {
    render();
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });

    // The roster is 09:00–18:00 in the fixture and does not narrow it…
    render(visit({ rosterStartMinute: 540, rosterEndMinute: 1080 }));
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });

    // …nor does a visit that starts before the shift, nor an unreadable one.
    render(visit({ startMinute: 60, endMinute: 105 }));
    expect(frameGrid().uiWindow()).toEqual({ startMinute: 0, endMinute: 1440 });
  });

  it('does not draw the day shut when the roster reads across midnight', () => {
    // A chair rostered 14:00–00:00 arrives as 840 → 0, because the dashboard
    // reads that end as a wall-clock minute without anchoring it to the day.
    // Handed to the grid raw, an inverted window is DROPPED by `closedRuns`
    // and the whole frame paints as shut hours — under a visit sitting
    // squarely inside the shift.
    render(
      visit({
        rosterStartMinute: 840,
        rosterEndMinute: 0,
        startMinute: 900,
        endMinute: 945,
      }),
    );

    expect(frameGrid().columns()[0]?.open).toEqual([
      { startMinute: 0, endMinute: 1440 },
    ]);
  });

  it('hands the frame its drag copy with the placeholder intact', async () => {
    const host = render();
    await fixture.whenStable();
    fixture.detectChanges();

    const grid = fixture.debugElement.query(By.directive(StaffTimeGrid));
    expect(grid).not.toBeNull();
    const copy = (grid.componentInstance as StaffTimeGrid).uiDragCopy();

    expect(copy.minutes).toBe('{{minutes}} мин');
    // Not the empty hole the no-argument call would have left behind.
    expect(copy.minutes).not.toBe(' мин');
    expect(host).toBeTruthy();
  });

  /*
   * THE REST OF THE BOOKING.
   *
   * This sheet frames ONE chair's share of a party, so it has to say when
   * there is more of it — otherwise a barber editing their own seat reads the
   * sheet as the whole visit and cannot reach the other half at all.
   */
  it('says nothing about a party on an ordinary one-person visit', () => {
    const host = render();
    expect(host.querySelector('[data-testid^="staff-visit-peer-"]')).toBeNull();
  });

  it('names the other chairs of a party, and pushes the sheet to one', () => {
    const host = render(
      visit({
        peers: [
          {
            rowId: 'appointment-1#stefan',
            clientLabel: 'Синът на Стоян',
            chairName: 'Стефан Илиев',
            chairTone: 3,
            timeLabel: '16:00 – 16:30',
          },
        ],
      }),
    );

    const testId = 'staff-visit-peer-appointment-1#stefan';
    const peer = find(host, testId);
    expect(peer).not.toBeNull();
    // The PERSON in that chair, not this sheet's client — on a party they are
    // different people, which is the whole reason the row is worth drawing.
    expect(text(host, testId)).toContain('Синът на Стоян');
    expect(text(host, testId)).toContain('Стефан Илиев');

    let picked: string | null = null;
    fixture.componentInstance.peerPicked.subscribe((id) => (picked = id));
    peer?.click();
    fixture.detectChanges();
    // The ROW's name, not the appointment's — the appointment names both
    // halves and could not say which one to re-frame on.
    expect(picked).toBe('appointment-1#stefan');
  });

  it('renders the ladder: participants, the framed day with its clock beneath it', () => {
    const host = render();

    // ⚠ The SUMMARY STRIP is gone (owner ruling 2026-08-27), and with it the
    // component's own name, `⋯` and `✕`. The shell carries a plain title and
    // a close button like every other sheet on this page; the strip
    // duplicated that job, carried a second dismiss, and — projected as one
    // element — could never reach the `sheet-accessory` slot, so the `✕` it
    // held scrolled away with the content.
    expect(
      host.querySelector('[data-testid="staff-visit-summary"]'),
    ).toBeNull();
    expect(host.querySelector('.staff-visit__strip')).toBeNull();
    expect(host.querySelector('[data-testid="staff-visit-close"]')).toBeNull();
    /*
     * ⚠ NO LARGE TITLE AT ALL (owner ruling 2026-09-04, reversing
     * 2026-08-27). The name is `Редактиране на час` on every visit — never
     * the answer to a question anybody opened this sheet with — and it was
     * spending a `largeTitle` block at the top of an eight-group ladder to
     * say it. The shell carries it in the bar permanently
     * (`titleAlwaysVisible`), and the `labelledBy` id moved to the
     * `[sheet-title]` span with it, which is the OWNER's markup and so is
     * asserted in the dashboard's suite, not here.
     */
    expect(host.querySelector('#staff-visit-title')).toBeNull();
    expect(find(host, 'staff-visit-large-title')).toBeNull();
    expect(host.querySelector('[uiSheetLargeTitle]')).toBeNull();
    // NOTHING TO TRACK (owner, 2026-09-09): an ordinary confirmed visit
    // has no state strip at all — the first thing under the thumb is the
    // chair. The head speaks only for a decision (see `the head of the
    // sheet`).
    expect(find(host, 'staff-visit-state')).toBeNull();
    expect(
      host
        .querySelector('.staff-visit__body > :first-child')
        ?.getAttribute('aria-label'),
    ).toBe('Бръснари');

    // ⚠ The overflow is ABSENT here (owner ruling 2026-09-04): this fixture's
    // graph allows nothing but the primary verb, and a `⋯` that opens on an
    // empty menu is the disabled promise this surface keeps refusing. When
    // the graph DOES allow more it is in the dock — see `the overflow`.
    expect(find(host, 'staff-visit-more')).toBeNull();

    // STATE → picture → clock → people (owner review 2026-09-08, moving the
    // frame up from under the participants): time is the second thing on
    // the sheet, with the two authored facts BELOW the frame and no `До`
    // field anywhere; the date navigator heads the frame.
    const order = [...host.querySelectorAll('[data-testid]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter(
        (id): id is string =>
          id === 'staff-visit-barber-ivan' ||
          id === 'staff-visit-client-row-user-martin' ||
          id === 'staff-visit-frame' ||
          id === 'staff-visit-start',
      );
    // REVERSED AGAIN (owner, 2026-09-09): the people and the services come
    // BEFORE the frame — a barber picks what and for whom, and the duration
    // follows; the time is confirmed last. The barber row stays with the
    // clock, under the frame.
    // The chair comes first of all (owner, 2026-09-09): it decides which
    // services are on offer, so it is answered before the ladder is drawn.
    // …and the PEOPLE come after the time (owner, 2026-09-09): who it is
    // for is the last thing agreed — a walk-in has no name to give until
    // the cut is.
    // …and the typed pair sits ABOVE the picture (owner, 2026-09-09): the
    // figures are the truth, the frame beneath them is the check.
    expect(order).toEqual([
      'staff-visit-barber-ivan',
      'staff-visit-frame',
      'staff-visit-start',
      'staff-visit-client-row-user-martin',
    ]);
    // The Today chip is gone: the popover's own Днес does that job.
    expect(find(host, 'staff-visit-day-today')).toBeNull();

    // ⚠ The pill is INSIDE the frame now, so a document-order list would put
    // the ancestor first and say nothing. `contains` is the assertion that
    // actually encodes "the date navigator heads the picture".
    const frame = find(host, 'staff-visit-frame');
    const pill = find(host, 'staff-visit-day-pill');
    expect(pill && frame?.contains(pill)).toBe(true);
    // …and it heads it: the navigator precedes the grid inside the section.
    expect(
      pill?.compareDocumentPosition(
        host.querySelector('lib-staff-time-grid') as Node,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The barbers are PARTICIPANTS, named at the top with the services they
    // work — the frame's own chair header, which used to be the only place a
    // barber was named, is gone with the avatar that carried it.
    expect(text(host, 'staff-visit-barber-ivan')).toContain('Иван');
    expect(text(host, 'staff-visit-barber-niko')).toContain('Нико');
    expect(
      find(host, 'staff-visit-frame')?.querySelector('ui-avatar'),
    ).toBeNull();
    expect(host.querySelector('.staff-frame__owner')).toBeNull();
    expect(host.querySelector('lib-staff-time-grid')).not.toBeNull();

    // The pill is always value-bearing, and the calendar is closed until asked.
    expect(text(host, 'staff-visit-day-pill')).toContain('ср, 26.08');
    expect(
      find(host, 'staff-visit-day-pill')?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(find(host, 'staff-visit-calendar')).toBeNull();

    // The barber is named on a leg's line ONLY when he is not the chair.
    expect(text(host, 'staff-visit-leg-line-seat-cut')).toBe('30 мин');
    expect(text(host, 'staff-visit-leg-line-seat-beard')).toBe('15 мин · Нико');

    // No section eyebrows anywhere: a group's name is its aria-label.
    expect(host.querySelector('ui-section-header')).toBeNull();

    // No honesty footnote any more: nothing the sheet shows is unsaved
    // (owner, 2026-09-10 — the promotion left with its page).
    expect(find(host, 'staff-visit-not-built')).toBeNull();
  });

  it('carries its chips on the ladder row — variant, and the way off — and swipes to remove', () => {
    // One row is one seat (owner, 2026-09-10): the title with its variant,
    // the variant chip, and a visible «−». No counter, no money — the
    // receipt says what a seat costs. No barber chip (2026-09-09): the
    // sheet is opened for a chair, and the chair row above is where it
    // changes.
    const host = render();
    const row = find(host, 'staff-visit-leg-seat-cut');
    expect(row?.tagName).toBe('LI');
    expect(row?.querySelector('ui-list-row')).not.toBeNull();
    expect(find(host, 'staff-visit-page')).toBeNull();
    expect(find(host, 'staff-visit-leg-barber-seat-cut')).toBeNull();
    expect(
      host.querySelector('[data-testid^="staff-visit-leg-count-"]'),
    ).toBeNull();
    expect(row?.textContent).not.toContain('20,00 €');
    // The way off is in sight, and named — HIG's alternative to a swipe.
    const remove = find(host, 'staff-visit-remove-leg-seat-cut');
    expect(remove?.tagName).toBe('BUTTON');
    expect(remove?.getAttribute('aria-label')).toContain('Премахни услугата');

    // The variant chip is an ICON on the service that has variants; the
    // title carries the variant's name, joined the way the catalogue does.
    const variant = find(host, 'staff-visit-leg-variant-seat-cut');
    expect(variant).not.toBeNull();
    expect(variant?.hasAttribute('data-icon-only')).toBe(true);
    expect(variant?.textContent).not.toContain('Къса коса');
    expect(find(host, 'staff-visit-leg-variant-seat-beard')).toBeNull();
    // This seat was stored without a variant: its title is the stored
    // name until a variant is picked, and then the catalogue's joined one.
    expect(row?.textContent).toContain('Класическо подстригване');
    expect(variant?.getAttribute('aria-label')).toContain('—');
    click(host, 'staff-visit-leg-variant-seat-cut');
    pickOpen(host, 'staff-visit-variant-pick-long');
    // The variant is a DESCRIPTION now — under the service, not welded to it.
    expect(row?.textContent).toContain('Подстригване');
    expect(row?.textContent).toContain('Дълга коса');
    expect(row?.textContent).not.toContain('Подстригване · Дълга коса');
    expect(variant?.getAttribute('aria-label')).toContain('Дълга коса');
    expect(text(host, 'staff-visit-leg-line-seat-cut')).toContain('45 мин');

    // The «−» removes the seat; the swipe's own act is a button too.
    expect(find(host, 'staff-visit-swipe-leg-seat-beard')?.tagName).toBe(
      'BUTTON',
    );
    click(host, 'staff-visit-remove-leg-seat-cut');
    expect(find(host, 'staff-visit-leg-seat-cut')).toBeNull();
  });

  it('moves the derived end when the visit gets longer, and leaves the price alone', () => {
    const host = render();
    const duration = () =>
      find(host, 'staff-visit-duration') as HTMLInputElement;
    expect(duration().value).toBe('45');
    // Length is the VISIT's now (the leg page is retired): the typed figure
    // pins the whole span, the end follows as a computation, the price
    // stays what the seats say.
    duration().value = '75';
    duration().dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(duration().value).toBe('75');
    expect(text(host, 'staff-visit-frame-summary')).toContain('11:15');
    expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');
  });

  describe('adding a service', () => {
    const page = (host: HTMLElement) => find(host, 'staff-visit-page');
    const onPage = (host: HTMLElement) =>
      page(host)?.getAttribute('data-page') === 'service';
    /** The catalogue's PICKS — the checkbox rows, not the dock's own buttons. */
    const PICKS =
      'button[role="checkbox"][data-testid^="staff-visit-service-"]';
    const rows = (host: HTMLElement) => host.querySelectorAll(PICKS).length;
    const query = (host: HTMLElement) =>
      find(host, 'staff-visit-service-query') as HTMLInputElement | null;

    // ONE SEARCH GRAMMAR (owner, 2026-09-24: "I like how the client sheet
    // on input focus collapses the title — this should be done in adding a
    // service and other places").
    it("folds the catalogue's title while its search is engaged, says «nothing matched» as the search's own figure, and lets the keyboard go on Return", () => {
      const host = render();
      click(host, 'staff-visit-add-service');
      const editor = fixture.componentInstance;
      const head = () =>
        host.querySelector('[data-page="service"] ui-sheet-headline');
      const field = find(host, 'staff-visit-service-query') as HTMLInputElement;
      expect(editor.searchEngaged()).toBe(false);
      expect(head()?.hasAttribute('data-folded')).toBe(false);

      field.dispatchEvent(new Event('focus'));
      fixture.detectChanges();
      expect(editor.searchEngaged()).toBe(true);
      expect(head()?.hasAttribute('data-folded')).toBe(true);

      field.value = 'щщщ';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      const empty = find(host, 'staff-visit-service-empty');
      expect(empty?.tagName).toBe('FIGURE');
      expect(empty?.querySelector('ui-icon')).not.toBeNull();

      // Return: the keyboard goes, the query stands, the title stays folded.
      field.focus();
      const enter = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enter);
      field.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      expect(enter.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(field);
      expect(head()?.hasAttribute('data-folded')).toBe(true);

      // Emptied and left, it comes back; a page re-opened starts unfolded.
      field.value = '';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(head()?.hasAttribute('data-folded')).toBe(false);
    });

    it('gives every page one head: the title and at most one line, in the DS headline', () => {
      const host = render();
      for (const door of [
        'staff-visit-add-service',
        'staff-visit-add-client',
      ]) {
        click(host, door);
        const title = host.querySelector('#staff-visit-page-title');
        expect(title?.closest('ui-sheet-headline')).not.toBeNull();
        fixture.componentInstance.pop();
        fixture.detectChanges();
      }
    });

    it('pushes the catalogue as a page — searchable, picked on tap, the dock adding — never a menu or a sheet', () => {
      // Owner, 2026-09-17: "adding a service → push sheet / page".
      const host = render();
      const add = find(host, 'staff-visit-add-service');
      expect(add?.getAttribute('aria-haspopup')).toBeNull();
      expect(
        add?.querySelector('[uileading] ui-icon[data-name="action.add"]'),
      ).not.toBeNull();
      expect(page(host)).toBeNull();
      expect(query(host)).toBeNull();

      click(host, 'staff-visit-add-service');
      expect(onPage(host)).toBe(true);
      expect(fixture.componentInstance.depth()).toBe(1);
      expect(fixture.componentInstance.pageTitle()).toBe('Добави услуга');
      expect(
        host.querySelector('#staff-visit-page-title')?.textContent?.trim(),
      ).toBe('Добави услуга');
      expect(
        host.querySelector('ui-modal-sheet, ui-menu[data-open]'),
      ).toBeNull();

      // The search is PINNED under the bar — the DS search field, the
      // client page's own — and NOT focused: a catalogue this size is
      // scanned first.
      const field = query(host);
      expect(field?.closest('ui-search-field[data-pinned]')).not.toBeNull();
      expect(field?.closest('[data-testid="staff-visit-page"]')).not.toBeNull();
      expect(document.activeElement).not.toBe(field);

      // Each row: the PICK — a checkbox button that is the row's label —
      // and a count stepper trailing, one square at zero. Nothing picked,
      // nothing checked, and the dock's ✓ with no promise.
      const items = [...host.querySelectorAll(PICKS)];
      expect(items.length).toBe(CATALOGUE.length);
      expect(items[0]?.getAttribute('role')).toBe('checkbox');
      expect(items[0]?.getAttribute('aria-checked')).toBe('false');
      const stepper = items[0]
        ?.closest('.ui-list-row')
        ?.querySelector('ui-count-stepper');
      expect(stepper?.closest('[uitrailing]')).not.toBeNull();
      expect(stepper?.getAttribute('data-count')).toBe('0');
      // The row rides the DS interactive grammar — hover and press ink —
      // like every tappable row (owner, 2026-09-17: "no hover effect
      // although they are interactive").
      expect(
        items[0]?.closest('.ui-list-row')?.hasAttribute('data-interactive'),
      ).toBe(true);
      expect(items[0]?.textContent).toContain(CATALOGUE[0]?.serviceLabel ?? '');
      expect(items[0]?.textContent).toContain(CATALOGUE[0]?.variantLabel ?? '');
      expect(items[0]?.textContent).not.toContain(CATALOGUE[0]?.label);
      expect(items[0]?.textContent).toContain('мин');
      expect(find(host, 'staff-visit-service-apply')).toBeNull();
      expect(find(host, 'staff-visit-page-done')).not.toBeNull();
      // The ✓ pops the page.
      click(host, 'staff-visit-page-done');
      expect(page(host)).toBeNull();
    });

    it('picks on tap — the row selects and its stepper unfolds — counts a second of the same, and the dock seats the picks', async () => {
      // Owner, 2026-09-17: "animated like select — in place of a check, a
      // stepper should animate, expand"; select, then the dock applies.
      const host = render();
      const LEG_ROWS = 'li[data-testid^="staff-visit-leg-"]';
      const legsBefore = host.querySelectorAll(LEG_ROWS).length;
      const wash = () => find(host, 'staff-visit-service-wash');
      const row = () => wash()?.closest('.ui-list-row');
      const stepper = () => find(host, 'staff-visit-service-wash-count');

      click(host, 'staff-visit-add-service');
      if (!wash()) throw new Error('no wash in the catalogue');
      click(host, 'staff-visit-service-wash');
      // Picked, not seated: the row is checked and washed, the stepper's
      // square is a ✓ for a beat, the dock promises «Добави», the ladder
      // waits.
      expect(onPage(host)).toBe(true);
      expect(wash()?.getAttribute('aria-checked')).toBe('true');
      expect(row()?.hasAttribute('data-selected')).toBe(true);
      expect(stepper()?.getAttribute('data-count')).toBe('1');
      expect(
        stepper()
          ?.querySelector('.ui-count-stepper__add')
          ?.hasAttribute('data-added'),
      ).toBe(true);
      expect(text(host, 'staff-visit-service-apply')).toBe('Добави');
      expect(
        find(host, 'staff-visit-service-apply')?.getAttribute(
          'data-button-style',
        ),
      ).toBe('borderedProminent');
      expect(find(host, 'staff-visit-page-done')).toBeNull();
      // (The ladder is behind the page; nothing is seated until the act.)
      expect(host.hasAttribute('data-dirty')).toBe(false);

      // The beat over, the square has unfolded into «− 1 +»: one more of
      // the same is a press there, and the dock counts it.
      await new Promise((resolve) => setTimeout(resolve, 650));
      fixture.detectChanges();
      expect(stepper()?.querySelector('.ui-count-stepper__add')).toBeNull();
      expect(
        stepper()
          ?.querySelector('.ui-count-stepper__count')
          ?.textContent?.trim(),
      ).toBe('1');
      const steps = stepper()?.querySelectorAll<HTMLElement>(
        '.ui-count-stepper__step',
      );
      steps?.[1]?.click();
      fixture.detectChanges();
      expect(stepper()?.getAttribute('data-count')).toBe('2');
      expect(text(host, 'staff-visit-service-apply')).toBe('Добави 2 услуги');
      // Down to none: the pick is off, the row plain, the dock's ✓ back.
      steps?.[0]?.click();
      fixture.detectChanges();
      steps?.[0]?.click();
      fixture.detectChanges();
      expect(stepper()?.getAttribute('data-count')).toBe('0');
      expect(wash()?.getAttribute('aria-checked')).toBe('false');
      expect(row()?.hasAttribute('data-selected')).toBe(false);
      expect(find(host, 'staff-visit-service-apply')).toBeNull();
      expect(find(host, 'staff-visit-page-done')).not.toBeNull();

      // Picked again, and «Добави» seats it: the seat is on the ladder, the
      // page is gone; a tap on a picked row takes the pick off.
      click(host, 'staff-visit-service-wash');
      click(host, 'staff-visit-service-wash');
      expect(wash()?.getAttribute('aria-checked')).toBe('false');
      click(host, 'staff-visit-service-wash');
      click(host, 'staff-visit-service-apply');
      expect(host.querySelectorAll(LEG_ROWS).length).toBe(legsBefore + 1);
      expect(page(host)).toBeNull();
      expect(host.hasAttribute('data-dirty')).toBe(true);

      // Next time, NOTHING is marked as already on the visit (owner,
      // 2026-09-10): a service may be wanted twice — the stepper counts
      // it — and a check would read as done; nothing is picked either.
      click(host, 'staff-visit-add-service');
      expect(onPage(host)).toBe(true);
      expect(
        host.querySelector('[data-testid^="staff-visit-seated-"]'),
      ).toBeNull();
      expect(wash()?.getAttribute('aria-checked')).toBe('false');
      expect(find(host, 'staff-visit-service-apply')).toBeNull();
      // Two of one and one of another, seated together in the order picked.
      click(host, 'staff-visit-service-fade');
      click(host, 'staff-visit-service-wash');
      await new Promise((resolve) => setTimeout(resolve, 650));
      fixture.detectChanges();
      find(host, 'staff-visit-service-fade-count')
        ?.querySelectorAll<HTMLElement>('.ui-count-stepper__step')[1]
        ?.click();
      fixture.detectChanges();
      expect(text(host, 'staff-visit-service-apply')).toBe('Добави 3 услуги');
      click(host, 'staff-visit-service-apply');
      expect(host.querySelectorAll(LEG_ROWS).length).toBe(legsBefore + 4);
      expect(page(host)).toBeNull();

      // Picks not seated go with the page: the shell's ‹ leaves the
      // ladder as it was.
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-wash');
      back();
      expect(page(host)).toBeNull();
      expect(host.querySelectorAll(LEG_ROWS).length).toBe(legsBefore + 4);
      click(host, 'staff-visit-add-service');
      expect(wash()?.getAttribute('aria-checked')).toBe('false');
    });

    it('takes a letter typed anywhere into its search while the page is up — and stops listening once it is gone', () => {
      const host = render();
      click(host, 'staff-visit-add-service');
      // Focus is on the page, not in the field — where a push leaves it.
      // The key still lands in the field.
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ф', bubbles: true }),
      );
      fixture.detectChanges();
      expect(query(host)?.value).toBe('ф');
      expect(document.activeElement).toBe(query(host));
      expect(rows(host)).toBeLessThan(CATALOGUE.length);
      // Typing IN the field is its own business — no doubled letter.
      query(host)?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'е', bubbles: true }),
      );
      expect(query(host)?.value).toBe('ф');

      // Gone with the page, the document is left alone.
      back();
      expect(page(host)).toBeNull();
      expect(query(host)).toBeNull();
      expect(() => {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'х', bubbles: true }),
        );
        fixture.detectChanges();
      }).not.toThrow();
      expect(host.hasAttribute('data-dirty')).toBe(false);
    });

    it('opens on the whole catalogue every time, whatever was typed last', () => {
      const host = render();
      click(host, 'staff-visit-add-service');
      const field = query(host);
      if (!field) throw new Error('no search on the page');
      field.value = 'фейд';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(rows(host)).toBeLessThan(CATALOGUE.length);
      back();
      click(host, 'staff-visit-add-service');
      expect(query(host)?.value).toBe('');
      expect(rows(host)).toBe(CATALOGUE.length);
    });
  });

  /*
   * ── THE DRAFT SURVIVES A NEW VM ───────────────────────────────────────
   *
   * The draft is reseeded when the SUBJECT changes and never otherwise. That
   * was always the intent and it was not the behaviour: `linkedSignal`
   * re-derives when its source's DEPENDENCIES change, not only when the
   * source's value does, so any fresh `VisitEditorVm` object wiped what the
   * barber had typed while the appointment id beside it stayed identical.
   *
   * It was silent because `nowMinute` is on the VM and ticks every sixty
   * seconds: a draft left open across a minute boundary reset itself, and a
   * suite that never pushes a second VM could not see it.
   */
  describe('the draft', () => {
    it('survives a new VM for the same appointment', () => {
      const host = render();

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(host.getAttribute('data-draft-day')).toBe('2026-08-27');
      expect(host.hasAttribute('data-dirty')).toBe(true);

      // The clock ticks: same appointment, new object, one volatile field.
      fixture.componentRef.setInput('vm', visit({ nowMinute: 601 }));
      fixture.detectChanges();

      expect(host.getAttribute('data-draft-day')).toBe('2026-08-27');
      expect(host.hasAttribute('data-dirty')).toBe(true);
    });

    it('is reseeded when the sheet is handed a different appointment', () => {
      const host = render();

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(host.getAttribute('data-draft-day')).toBe('2026-08-27');

      fixture.componentRef.setInput(
        'vm',
        visit({ appointmentId: 'appointment-2' }),
      );
      fixture.detectChanges();

      expect(host.getAttribute('data-draft-day')).toBe('2026-08-26');
      expect(host.hasAttribute('data-dirty')).toBe(false);
    });

    /*
     * Re-dating is a CHANGE. The seed used to be fed from the drafted day
     * itself, so it moved with the value it was measuring and `dirty` stayed
     * false — no discard control, and any future `Запази` would have had
     * nothing to tell it the booking had moved.
     */
    it('counts a moved day as dirty', () => {
      const host = render();
      expect(host.hasAttribute('data-dirty')).toBe(false);

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(host.hasAttribute('data-dirty')).toBe(true);
      // The dock's one commit appears with the change it would commit.
      expect(find(host, 'staff-visit-save')).not.toBeNull();

      find(host, 'staff-visit-day-prev')?.click();
      fixture.detectChanges();
      expect(host.hasAttribute('data-dirty')).toBe(false);
    });
  });

  /*
   * ── THE FRAME FOLLOWS THE PILL ────────────────────────────────────────
   *
   * The frame is fed by the VM, which the parent computes from the day the
   * AGENDA is showing — so stepping the pill moved the draft and left the
   * picture behind. The day has to cross the boundary for the parent to keep
   * it live and hand back the right lane.
   */
  describe('the drafted day', () => {
    it('is published whenever it moves, and on open', () => {
      const seen: string[] = [];
      fixture.componentRef.setInput('vm', visit());
      fixture.componentRef.setInput('uiServices', CATALOGUE);
      fixture.componentInstance.dayChanged.subscribe((day) => seen.push(day));
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      // On open, so the parent never has to guess the starting day.
      expect(seen).toEqual(['2026-08-26']);

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(seen.at(-1)).toBe('2026-08-27');

      find(host, 'staff-visit-day-prev')?.click();
      fixture.detectChanges();
      expect(seen.at(-1)).toBe('2026-08-26');
    });

    /*
     * An EFFECT on the draft, not an emit in each handler: there are four
     * ways the day moves — three buttons and the month grid — and the month
     * grid is the one a per-handler emit would have missed.
     */
    it('publishes a day picked from the month grid too', () => {
      const seen: string[] = [];
      fixture.componentRef.setInput('vm', visit());
      fixture.componentRef.setInput('uiServices', CATALOGUE);
      fixture.componentInstance.dayChanged.subscribe((day) => seen.push(day));
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      find(host, 'staff-visit-day-pill')?.click();
      fixture.detectChanges();
      // The grid is the DS month picker's, so the day carries its id.
      find(host, 'ui-month-day-2026-08-30')?.click();
      fixture.detectChanges();

      expect(seen.at(-1)).toBe('2026-08-30');
    });
  });

  /*
   * ── THE DAY PILL'S FORMAT ────────────────────────────────────────────
   *
   * The VM's own `dayLabel` is a literal in this fixture, so `dayLabelFor`
   * — the formatter behind it — was never once executed by this suite. It
   * only runs when the draft's day CHANGES, which is what stepping does.
   */
  describe('the day pill', () => {
    it("names the day the way the toolbar does — the locale's compact date", () => {
      // One pill component, one grammar, both places (owner, 2026-09-09):
      // the compact date exactly as `Intl` renders it — numeric month in
      // Bulgarian, `чт, 27.08`.
      const host = render();
      expect(text(host, 'staff-visit-day-pill')).toContain('ср, 26.08');

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();

      expect(text(host, 'staff-visit-day-pill')).toContain('чт, 27.08');
    });
  });

  /*
   * ── СТАТУС ───────────────────────────────────────────────────────────
   *
   * One control at the top holds the state AND every way out of it. Before
   * this, `status`/`statusLabel`/`statusTone()` sat on the contract unused
   * while the transitions were split across a prominent CTA and a `⋯` —
   * a seam the state machine does not have.
   */
  /*
   * ── THE HEAD OF THE SHEET ────────────────────────────────────────────
   *
   * NOTHING TO TRACK (owner, 2026-09-09): the status chip and the stamps —
   * «Дойде», «Готово» — are gone. No barber has the time to note who came
   * and when a cut ended, and the frame already shows where the clock is.
   * What the head still says is a DECISION: a request to answer. Nothing
   * else — not the clock, not the kind (both tried and withdrawn the same
   * day).
   */
  describe('the head of the sheet', () => {
    it('tracks nothing: no status, no stamp, no picker on an ordinary visit', () => {
      const host = render();
      expect(find(host, 'staff-visit-state')).toBeNull();
      expect(find(host, 'staff-visit-status')).toBeNull();
      expect(
        host.querySelector('[data-testid^="staff-visit-verb-"]'),
      ).toBeNull();
      expect(
        host.querySelector('[data-testid^="staff-visit-act-"]'),
      ).toBeNull();
      // …nor once the party is in, nor once the time has gone.
      expect(
        find(
          render(visit({ arrivedMinute: 590, nowMinute: 596 })),
          'staff-visit-state',
        ),
      ).toBeNull();
      expect(
        find(render(visit({ nowMinute: 700 })), 'staff-visit-state'),
      ).toBeNull();
    });

    it('asks to answer a request, and only a request, at the top', () => {
      const host = render(
        visit({
          status: 'pending',
          statusLabel: 'Заявен',
          primaryVerb: {
            kind: 'confirmed',
            label: 'Потвърди',
            destructive: false,
          },
          overflowVerbs: [
            { kind: 'cancelled', label: 'Откажи', destructive: true },
          ],
        }),
      );
      expect(find(host, 'staff-visit-state')?.getAttribute('data-head')).toBe(
        'request',
      );
      expect(find(host, 'staff-visit-state')?.getAttribute('data-tone')).toBe(
        'warning',
      );
      const acted: string[] = [];
      fixture.componentInstance.acted.subscribe((kind) => acted.push(kind));
      click(host, 'staff-visit-confirm');
      expect(acted).toEqual(['confirmed']);
      // The refusal is an exit, at the foot, with the others.
      expect(
        find(host, 'staff-visit-cancel')?.closest(
          '[data-testid="staff-visit-exits"]',
        ),
      ).not.toBeNull();
    });

    it('says nothing about the clock — not before, not late, not after', () => {
      // The «закъснява · +10 · +15» nudge lasted a day (owner, 2026-09-09:
      // "what sense does this make"). A barber who is late moves the block
      // or types the start; the head does not guess by how much.
      let host: HTMLElement | null = null;
      for (const nowMinute of [590, 606, 650]) {
        host = render(visit({ nowMinute }));
        expect(find(host, 'staff-visit-state')).toBeNull();
      }
      expect(
        host?.querySelector('[data-testid^="staff-visit-late-"]'),
      ).toBeNull();
    });
  });

  /*
   * ── THE EXITS ────────────────────────────────────────────────────────
   *
   * What the sheet can still do that is not an edit, as its LAST group —
   * the way iOS Calendar keeps «Delete Event» last. Named acts, the
   * destructive ones after the rest, never a stamp among them.
   */
  describe('the exits', () => {
    const cancellable = (nowMinute: number) =>
      visit({
        nowMinute,
        primaryVerb: { kind: 'arrived', label: 'Дойде', destructive: false },
        overflowVerbs: [
          { kind: 'completed', label: 'Готово', destructive: false },
          { kind: 'no_show', label: 'Не дойде', destructive: false },
          { kind: 'cancelled', label: 'Откажи', destructive: true },
        ],
      });
    const ids = (host: HTMLElement) =>
      [
        ...host.querySelectorAll(
          '[data-testid="staff-visit-exits"] [data-testid]',
        ),
      ].map((el) => el.getAttribute('data-testid'));

    it('are the last group: cancel and cancel-and-block, never a stamp', () => {
      const host = render(cancellable(590));
      const exits = find(host, 'staff-visit-exits');
      expect(exits).not.toBeNull();
      expect(exits?.nextElementSibling).toBeNull();
      // Before the start nobody has failed to come; the stamps are not
      // offered at all, whatever the graph allows.
      expect(ids(host)).toEqual([
        'staff-visit-cancel',
        'staff-visit-cancel-block',
      ]);
      expect(text(host, 'staff-visit-cancel')).toContain('Откажи часа');
      expect(
        find(host, 'staff-visit-cancel')?.classList.contains(
          'staff-visit__exit--destructive',
        ),
      ).toBe(true);

      const acted: string[] = [];
      fixture.componentInstance.acted.subscribe((kind) => acted.push(kind));
      const blocked: number[] = [];
      fixture.componentInstance.blockedInstead.subscribe(() => blocked.push(1));
      click(host, 'staff-visit-cancel');
      expect(acted).toEqual(['cancelled']);
      click(host, 'staff-visit-cancel-block');
      expect(blocked.length).toBe(1);
    });

    it('offers «Не дойде» once the start has passed, first of the three', () => {
      const host = render(cancellable(606));
      expect(ids(host)).toEqual([
        'staff-visit-no-show',
        'staff-visit-cancel',
        'staff-visit-cancel-block',
      ]);
      const acted: string[] = [];
      fixture.componentInstance.acted.subscribe((kind) => acted.push(kind));
      click(host, 'staff-visit-no-show');
      expect(acted).toEqual(['no_show']);
    });

    it('offers the way back from a no-show at the foot, and the next visit after a finished one', () => {
      const missed = render(
        visit({
          status: 'no_show',
          statusLabel: 'Пропуснат',
          primaryVerb: {
            kind: 'confirmed',
            label: 'Върни часа',
            destructive: false,
          },
          overflowVerbs: [],
        }),
      );
      // The correction stays at the foot; the next visit moved to the dock
      // once the visit was gone (owner, 2026-09-11) — one control per act.
      expect(ids(missed)).toEqual(['staff-visit-reinstate']);
      expect(text(missed, 'staff-visit-reinstate')).toContain('Върни часа');
      expect(
        find(missed, 'staff-visit-rebook')?.closest('ui-sheet-action-bar'),
      ).not.toBeNull();
      const acted: string[] = [];
      fixture.componentInstance.acted.subscribe((kind) => acted.push(kind));
      click(missed, 'staff-visit-reinstate');
      expect(acted).toEqual(['confirmed']);

      const done = render(
        visit({
          status: 'completed',
          statusLabel: 'Минал',
          primaryVerb: null,
          overflowVerbs: [],
        }),
      );
      expect(ids(done)).toEqual(['staff-visit-rebook']);
      const rebooked: number[] = [];
      fixture.componentInstance.rebooked.subscribe(() => rebooked.push(1));
      click(done, 'staff-visit-rebook');
      expect(rebooked.length).toBe(1);
      expect(find(done, 'staff-visit-state')).toBeNull();
    });
  });

  /*
   * ── THE DOCK ─────────────────────────────────────────────────────────
   *
   * With every transition in the picker, an overflow has nothing to
   * overflow and a prominent verb would be a second door onto a control the
   * sheet already states at the top. What is left is the one thing a barber
   * does from here that is not an edit.
   */
  describe('the dock', () => {
    it('carries no `⋯` and no verb button', () => {
      const host = render(
        visit({
          overflowVerbs: [
            { kind: 'cancelled', label: 'Откажи', destructive: true },
          ],
        }),
      );

      const bar = host.querySelector('ui-sheet-action-bar');
      expect(find(host, 'staff-visit-more')).toBeNull();
      expect(
        bar?.querySelector('[data-testid^="staff-visit-cancel"]'),
      ).toBeNull();
      // The cancel did not vanish — it is an exit, at the foot.
      expect(
        find(host, 'staff-visit-cancel')?.closest(
          '[data-testid="staff-visit-exits"]',
        ),
      ).not.toBeNull();
    });

    /*
     * The dock is the figure, the call and the verb. The call went to the
     * client row on 2026-09-08 and came back the next day (owner: "the
     * most common action you do when you open the appointment") — a dock
     * target is reached without looking, a row target has to be found.
     * The row keeps the number to read; it no longer carries a chip.
     */
    it('carries the call — the most common act — beside the save', () => {
      const host = render();
      const call = find(host, 'staff-visit-call');
      expect(call?.closest('ui-sheet-action-bar')).not.toBeNull();
      expect(call?.getAttribute('href')).toMatch(/^tel:/);
      expect(call?.getAttribute('aria-label')).toContain('Мартин Илиев');
      expect(find(host, 'staff-visit-call-user-martin')).toBeNull();
    });

    /*
     * `Затвори` was a discard wearing the word "close" — the sheet's ✕
     * already closes, so the dock held a second dismissal and no way to keep
     * anything. A sheet whose only dock verb throws work away cannot be used
     * to change something.
     */
    it('commits from the dock, rightmost, and never discards', () => {
      const host = render();
      expect(find(host, 'staff-visit-discard')).toBeNull();
      // Absent until there is something to commit.
      expect(find(host, 'staff-visit-save')).toBeNull();

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();

      const save = find(host, 'staff-visit-save');
      expect(save).not.toBeNull();
      expect(save?.getAttribute('uiButtonStyle')).toBe('borderedProminent');
      /*
       * ⚠ NOT spread. A spread CTA eats the bar's leftover width and pushes
       * the call away from it, leaving the two verbs at opposite ends of the
       * row. They hug and travel together on the thumb rail; the auto margin
       * that docks a prominent child moves onto the call in CSS.
       */
      expect(save?.hasAttribute('data-spread')).toBe(false);

      // Last of the controls, with the call immediately before it (back in
      // the dock, owner 2026-09-09) and the total leading — the honesty
      // line is `order: -1` and renders above them all.
      const controls = [
        ...(host.querySelector('ui-sheet-action-bar')?.children ?? []),
      ].filter((el) => !el.classList.contains('staff-visit__honesty'));
      expect(controls.at(-1)).toBe(save);
      expect(controls.at(-2)).toBe(find(host, 'staff-visit-call'));
      expect(controls.at(0)).toBe(find(host, 'staff-visit-total'));
    });

    /*
     * The save publishes the WHOLE draft and does not close the sheet: the
     * write is a round trip that can be refused, and a sheet that dismissed
     * itself on the tap would take the draft with it.
     */
    // The owner, 2026-09-23: the frame's gesture was the sheet's one
    // immediate write, and its toast's undo moved the server while this
    // draft stayed put. A finished drag is a draft edit now.
    it('keeps a finished drag in the draft — no commit until «Запази» carries it', () => {
      const host = render();
      const commits: unknown[] = [];
      fixture.componentInstance.committed.subscribe((c) => commits.push(c));
      (
        fixture.componentInstance as unknown as {
          onFrameCommit: (commit: unknown) => void;
        }
      ).onFrameCommit({
        id: 'appt-1',
        kind: 'move',
        startMinute: 660,
        endMinute: 705,
      });
      fixture.detectChanges();

      expect(commits).toEqual([]);
      expect(fixture.componentInstance.dirty()).toBe(true);

      find(host, 'staff-visit-save')?.click();
      fixture.detectChanges();
      expect(commits).toEqual([
        expect.objectContaining({
          kind: 'save',
          startMinute: 660,
          endMinute: 705,
        }),
      ]);
    });

    // The shell's «Отмени» on a save receipt (2026-09-23): once the server
    // agrees with the snapshot, the whole draft is taken from the row again.
    it('re-seeds the whole draft when the shell bumps the reseed mark', () => {
      const host = render();
      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.dirty()).toBe(true);

      // A mark raised for ANOTHER visit is not this sheet's to answer.
      fixture.componentRef.setInput('uiReseedMark', {
        appointmentId: 'somebody-else',
        n: 1,
      });
      fixture.detectChanges();
      expect(fixture.componentInstance.dirty()).toBe(true);

      fixture.componentRef.setInput('uiReseedMark', {
        appointmentId: fixture.componentInstance.vm().appointmentId,
        n: 2,
      });
      fixture.detectChanges();
      expect(fixture.componentInstance.dirty()).toBe(false);
      expect(find(host, 'staff-visit-save')).toBeNull();
    });

    it('publishes the whole draft, and stays open', () => {
      const host = render();
      const commits: unknown[] = [];
      fixture.componentInstance.committed.subscribe((c) => commits.push(c));

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      find(host, 'staff-visit-save')?.click();
      fixture.detectChanges();

      expect(commits).toEqual([
        {
          kind: 'save',
          dayKey: '2026-08-27',
          startMinute: 600,
          endMinute: 645,
          locationId: 'loc-center',
          note: null,
          discounts: [],
          vouchers: [],
          tipMinorUnits: null,
          clients: [
            {
              id: 'user-martin',
              label: 'Мартин Илиев',
              phone: '+359 88 123 4567',
            },
          ],
          legs: [
            {
              seatId: 'seat-cut',
              serviceId: 'cut',
              variantId: null,
              minutes: 30,
              priceLabel: '20,00 €',
              barberId: 'ivan',
              clientId: 'user-martin',
            },
            {
              seatId: 'seat-beard',
              serviceId: 'beard',
              variantId: null,
              minutes: 15,
              priceLabel: '8,00 €',
              barberId: 'niko',
              clientId: 'user-martin',
            },
          ],
        },
      ]);
      // Still rendered: the write is a round trip that can be refused, and
      // the owner closes the sheet only once the server has agreed.
      expect(find(host, 'staff-visit-root')).not.toBeNull();
    });

    /*
     * ⚠ ONE TAP, NOT TWO.
     *
     * `Запази` is rendered by `@if (dirty())` and the fields committed on
     * `change`, which fires on BLUR — so the tap reaching for the button was
     * the tap that CREATED it. The press landed on nothing, the blur made
     * the button appear under the finger, and the release had no element to
     * complete a click on. Committing while typing is what puts the button
     * on screen before the thumb arrives.
     */
    it('exists while the field is still being typed in', () => {
      const host = render();
      expect(find(host, 'staff-visit-save')).toBeNull();

      const field = find(host, 'staff-visit-duration') as HTMLInputElement;
      field.value = '60';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // No `change`, no blur — and the button is already there.
      expect(find(host, 'staff-visit-save')).not.toBeNull();
    });

    /*
     * The typing arm must not fight the typist: `6` on the way to `60` is
     * not a six-minute visit, and applying it would shrink the frame under
     * the reader between two keystrokes.
     */
    it('ignores a half-typed duration until it is whole', () => {
      const host = render();
      const field = find(host, 'staff-visit-duration') as HTMLInputElement;

      field.value = '6';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(find(host, 'staff-visit-save')).toBeNull();
      // ⚠ And the box still reads what was typed — the write-back that snaps
      // a value belongs to `change`, on blur, not under the cursor.
      expect(field.value).toBe('6');

      field.value = '60';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(find(host, 'staff-visit-save')).not.toBeNull();
      expect(field.value).toBe('60');
    });

    /*
     * ⚠ THE BUTTON MUST GO AWAY. It did not, and the reason was not timing:
     * the sheet and the server encode one visit two ways. A `resize` writes
     * the seat's own duration, so a 30-minute service stretched to 45 comes
     * back AS a 45-minute service while the draft still holds a 30-minute
     * leg under a 45-minute override. Two encodings, never string-equal,
     * `dirty` true forever.
     */
    it('goes away once the appointment says what was saved', () => {
      const host = render();

      find(host, 'staff-visit-day-next')?.click();
      fixture.detectChanges();
      expect(find(host, 'staff-visit-save')).not.toBeNull();

      // The write lands: the owner reports it and pushes the stored visit.
      fixture.componentRef.setInput('vm', visit({ dayKey: '2026-08-27' }));
      fixture.componentRef.setInput('uiSavedMark', 1);
      fixture.detectChanges();

      expect(host.hasAttribute('data-dirty')).toBe(false);
      expect(find(host, 'staff-visit-save')).toBeNull();
    });

    /*
     * Adoption waits for the seed to say what was SENT — its start and its
     * end — not merely to share the draft's end. Found 2026-09-23 while
     * exercising the save receipt: +5 on the start and −5 on the span kept
     * the end, the stale seed "agreed", and the sheet snapped back to the
     * pre-save values with «Запази» lit over a visit the server had taken.
     */
    it('does not adopt a stale seed that only shares the end minute', () => {
      const host = render();
      (
        fixture.componentInstance as unknown as {
          onFrameCommit: (commit: unknown) => void;
        }
      ).onFrameCommit({
        id: 'appt',
        kind: 'move',
        startMinute: 605,
        endMinute: 650,
      });
      fixture.detectChanges();
      const field = find(host, 'staff-visit-duration') as HTMLInputElement;
      field.value = '40';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(find(host, 'staff-visit-save')).not.toBeNull();
      find(host, 'staff-visit-save')?.click();
      fixture.detectChanges();

      // The owner reports the write before the stored visit has arrived:
      // the seed still reads 10:00–10:45, sharing only the end.
      fixture.componentRef.setInput('uiSavedMark', 1);
      fixture.detectChanges();
      expect(find(host, 'staff-visit-save')).not.toBeNull();
      expect(
        (find(host, 'staff-visit-duration') as HTMLInputElement).value,
      ).toBe('40');

      // The stored visit arrives, saying what was sent.
      fixture.componentRef.setInput(
        'vm',
        visit({ startMinute: 605, endMinute: 645 }),
      );
      fixture.detectChanges();
      expect(find(host, 'staff-visit-save')).toBeNull();
    });

    /*
     * The team note SAVES now (its own staff-only document beside the
     * appointment, 2026-09-08), so typing one is a change worth the button —
     * and it travels in the commit, trimmed, `null` when cleared.
     */
    it('raises the button for a typed note, and carries it in the commit', () => {
      const host = render();
      const commits: { note?: string | null }[] = [];
      fixture.componentInstance.committed.subscribe((c) =>
        commits.push(c as { note?: string | null }),
      );

      find(host, 'staff-visit-add-note')?.click();
      fixture.detectChanges();
      const note = find(host, 'staff-visit-note-field') as HTMLTextAreaElement;
      note.value = '  къса отстрани ';
      note.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(find(host, 'staff-visit-save')).not.toBeNull();
      find(host, 'staff-visit-save')?.click();
      expect(commits[0]?.note).toBe('къса отстрани');
    });

    it('seeds the note from the team note the sheet was handed', () => {
      const host = render(visit({ teamNote: 'дължи 5 €' }));
      const note = find(host, 'staff-visit-note-field') as HTMLTextAreaElement;
      expect(note?.value).toBe('дължи 5 €');
      // Unchanged, so not dirty.
      expect(find(host, 'staff-visit-save')).toBeNull();
    });

    it('draws no call at all when there is no number', () => {
      const host = render(visit({ phone: null, phoneHref: null }));
      expect(
        host.querySelector('[data-testid^="staff-visit-call"]'),
      ).toBeNull();
    });
  });

  /*
   * ── THE TOTAL IS IN THE DOCK ─────────────────────────────────────────
   *
   * It used to close `ПАРИ` as a semibold row, and it was not a peer of the
   * rows above it: promo and tip are inputs, `В салона` is the output, and
   * the figure sums `УСЛУГИ` as well — a summary that crosses the seam
   * cannot live inside one of the sections that feeds it. In the empty
   * state, which is most states, the money group contributed NOTHING to its
   * own total while rendering the heaviest — and only inert — row in the
   * section.
   */
  describe('the total', () => {
    it('is docked, not a row of the money group', () => {
      const host = render();

      const total = find(host, 'staff-visit-total');
      expect(total).not.toBeNull();
      expect(total?.closest('ui-sheet-action-bar')).not.toBeNull();
      // Label OVER figure — the Apple Pay stack, not a key/value row.
      expect(total?.firstElementChild?.textContent?.trim()).toBe('В салона');
      expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');

      // THE BILL (owner, 2026-09-16): the discount and the tip, no seat
      // lines — what a seat costs is the ladder's and the dock's business.
      const money = find(host, 'staff-visit-money');
      expect(money).not.toBeNull();
      expect(money?.contains(total as Node)).toBe(false);
      expect(find(host, 'staff-visit-price-seat-cut')).toBeNull();
      expect(find(host, 'staff-visit-price-row-seat-cut')).toBeNull();
      // The tip row is on every saved visit now (owner, 2026-09-10).
      expect(find(host, 'staff-visit-tip')).not.toBeNull();
      expect(find(host, 'staff-visit-payment')).toBeNull();
    });

    /*
     * ── THE TIP ROW (2026-09-15 / 16; a disclosure since 2026-09-17) ──
     * A VALUE row of the money group — «Бакшиш · Без ⌄» — that UNFOLDS its
     * tiles beneath itself (owner: "collapsible … expand the contents it
     * has now"): «Без», the round-ups a hand actually holds, the coins on
     * top, and «Друга сума» as a tile of its own, the sum written large
     * under it. A tile IS the answer: the draft takes it on the tap, the
     * row reads it, the dock's plus rises. The tip DRAFTS and travels with
     * «Запази»; nothing is written on a tap.
     */
    it('reads the tip on a value row that unfolds its tiles in place, drafts on a tile, and folds again', () => {
      const host = render();
      const row = find(host, 'staff-visit-tip');
      expect(row?.tagName).toBe('BUTTON');
      expect(row?.closest('[data-testid="staff-visit-money"]')).not.toBeNull();
      expect(row?.getAttribute('aria-haspopup')).toBeNull();
      expect(row?.getAttribute('aria-expanded')).toBe('false');
      expect(text(host, 'staff-visit-tip')).toMatch(
        /^Бакшиш\s*Оставен от клиента\s*Без$/,
      );
      // The one line of explanation is the row's own, under its name.
      expect(
        find(host, 'staff-visit-tip-description')?.closest(
          '[data-testid="staff-visit-tip"]',
        ),
      ).not.toBeNull();
      expect(text(host, 'staff-visit-tip-value')).toBe('Без');
      expect(row?.getAttribute('aria-label')).toBe('Бакшиш: Без');
      expect(
        row?.querySelector('ui-icon[data-name="field.expand"]'),
      ).not.toBeNull();
      expect(
        row?.querySelector('ui-icon[data-name="nav.disclosure"]'),
      ).toBeNull();
      // Folded: the section is in the segment's tree, inert, and the
      // segment is not open.
      expect(find(host, 'staff-visit-tip-section')?.hasAttribute('inert')).toBe(
        true,
      );
      expect(
        row?.closest('.staff-visit__extend')?.hasAttribute('data-open'),
      ).toBe(false);
      expect(find(host, 'staff-visit-dock-tip')).toBeNull();

      // Unfolded: the section under the row, inside the group, on no
      // page and no sheet — the one line of explanation, the bento four
      // across in the card's order, no field until «Друга сума».
      click(host, 'staff-visit-tip');
      expect(row?.getAttribute('aria-expanded')).toBe('true');
      expect(find(host, 'staff-visit-page')).toBeNull();
      expect(
        host.querySelector('ui-modal-sheet, ui-menu[data-open]'),
      ).toBeNull();
      const section = find(host, 'staff-visit-tip-section');
      expect(
        section?.closest('[data-testid="staff-visit-money"]'),
      ).not.toBeNull();
      // Inside the ROW'S OWN segment (owner, 2026-09-17: "the tip body inside
      // the tip row's body"), live now.
      expect(section?.hasAttribute('inert')).toBe(false);
      expect(section?.closest('.staff-visit__extend')).toBe(
        row?.closest('.staff-visit__extend'),
      );
      expect(
        row?.closest('.staff-visit__extend')?.hasAttribute('data-open'),
      ).toBe(true);
      const tiles = find(host, 'staff-visit-tip-tiles');
      const grid = tiles?.querySelector<HTMLElement>('[role="radiogroup"]');
      expect(grid?.style.getPropertyValue('--ui-choice-tiles-columns')).toBe(
        '4',
      );
      const ids = [...(tiles?.querySelectorAll('[role="radio"]') ?? [])].map(
        (node) => node.getAttribute('data-testid'),
      );
      expect(ids).toEqual([
        'staff-visit-tip-tile-200',
        'staff-visit-tip-tile-100',
        'staff-visit-tip-tile-500',
        'staff-visit-tip-tile-1000',
        'staff-visit-tip-tile-none',
        'staff-visit-tip-tile-other',
      ]);
      expect(
        find(host, 'staff-visit-tip-tile-200')?.getAttribute('data-size'),
      ).toBe('large');
      expect(
        find(host, 'staff-visit-tip-tile-other')?.getAttribute('data-size'),
      ).toBe('wide');
      expect(
        find(host, 'staff-visit-tip-tile-none')?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        find(host, 'staff-visit-tip-tile-200')?.querySelector(
          '.ui-choice-tile__detail',
        )?.textContent,
      ).toContain('общо 30,00');
      expect(text(host, 'staff-visit-tip-tile-100')).toBe('1,00 €');
      expect(find(host, 'staff-visit-tip-field')).toBeNull();

      // A tile IS the answer: the row reads it at once, the dock's plus
      // rises, the section stays open, and the tip travels with «Запази».
      click(host, 'staff-visit-tip-tile-200');
      expect(
        find(host, 'staff-visit-tip-tile-200')?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(text(host, 'staff-visit-tip-value')).toBe('2,00 €');
      expect(
        find(host, 'staff-visit-tip-value')?.getAttribute(
          'data-foreground-style',
        ),
      ).toBe('success');
      expect(row?.getAttribute('aria-label')?.replace(/\s+/g, ' ')).toBe(
        'Бакшиш: 2,00 €',
      );
      expect(text(host, 'staff-visit-dock-tip')).toBe('+2,00 € бакшиш');
      expect(
        find(host, 'staff-visit-dock-tip')?.getAttribute(
          'data-foreground-style',
        ),
      ).toBe('success');
      expect(find(host, 'staff-visit-tip-section')?.hasAttribute('inert')).toBe(
        false,
      );
      expect(host.hasAttribute('data-dirty')).toBe(true);
      const commits: unknown[] = [];
      fixture.componentInstance.committed.subscribe((c) => commits.push(c));
      click(host, 'staff-visit-save');
      expect(commits[0]).toMatchObject({ kind: 'save', tipMinorUnits: 200 });

      // «Друга сума» is a NEW choice: the preset is let go, the entry opens
      // on its muted zero, and the plus waits for a sum.
      click(host, 'staff-visit-tip-tile-other');
      expect(
        find(host, 'staff-visit-tip-tile-other')?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        find(host, 'staff-visit-tip-tile-200')?.getAttribute('aria-checked'),
      ).toBe('false');
      const entry = find(host, 'staff-visit-tip-entry');
      expect(entry?.tagName.toLowerCase()).toBe('ui-amount-field');
      const field = find(host, 'staff-visit-tip-field') as HTMLInputElement;
      expect(field.getAttribute('placeholder')).toBe('0,00');
      expect(field.getAttribute('inputmode')).toBe('decimal');
      expect(field.value).toBe('');
      expect(text(host, 'staff-visit-tip-value')).toBe('Без');
      expect(find(host, 'staff-visit-dock-tip')).toBeNull();
      // A step of the pair is a coin on top: 0,50 € — read on the row and
      // the dock; the tile keeps its name.
      click(host, 'staff-visit-tip-field-increase');
      expect(text(host, 'staff-visit-tip-tile-other')).toBe('Друга сума');
      expect(text(host, 'staff-visit-tip-value')).toBe('0,50 €');
      expect(text(host, 'staff-visit-dock-tip')).toBe('+0,50 € бакшиш');
      field.value = '5,50';
      field.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(text(host, 'staff-visit-tip-value')).toBe('5,50 €');
      // Return folds the section; the sum stands.
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      fixture.detectChanges();
      expect(find(host, 'staff-visit-tip-section')?.hasAttribute('inert')).toBe(
        true,
      );
      expect(row?.getAttribute('aria-expanded')).toBe('false');
      expect(text(host, 'staff-visit-tip-value')).toBe('5,50 €');
      expect(text(host, 'staff-visit-dock-tip')).toBe('+5,50 € бакшиш');

      // Unfolded again the custom tile is on with its sum; a step down
      // takes a coin off; «Без» clears — the row reads «Без» — and the
      // section stays until the row folds it.
      click(host, 'staff-visit-tip');
      expect(
        find(host, 'staff-visit-tip-tile-other')?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        (find(host, 'staff-visit-tip-field') as HTMLInputElement).value,
      ).toBe('5,50');
      click(host, 'staff-visit-tip-field-decrease');
      expect(text(host, 'staff-visit-tip-value')).toBe('5,00 €');
      click(host, 'staff-visit-tip-tile-none');
      expect(find(host, 'staff-visit-tip-field')).toBeNull();
      expect(text(host, 'staff-visit-tip-value')).toBe('Без');
      expect(find(host, 'staff-visit-dock-tip')).toBeNull();
      expect(find(host, 'staff-visit-tip-section')?.hasAttribute('inert')).toBe(
        false,
      );
      expect(host.hasAttribute('data-dirty')).toBe(false);
      click(host, 'staff-visit-tip');
      expect(find(host, 'staff-visit-tip-section')?.hasAttribute('inert')).toBe(
        true,
      );
      expect(row?.getAttribute('aria-expanded')).toBe('false');
    });

    it('reads a recorded tip back as its amount, and draws the round-ups a hand actually holds', () => {
      // 3,50 € on 28,00 €: the amount on the row, and no preset says it, so
      // «Друга сума» is the tile that is on, its field beneath holding the sum.
      let host = render(visit({ tipLabel: '3,50 €', tipMinorUnits: 350 }));
      expect(text(host, 'staff-visit-tip-value')).toBe('3,50 €');
      expect(text(host, 'staff-visit-dock-tip')).toBe('+3,50 € бакшиш');
      expect(host.hasAttribute('data-dirty')).toBe(false);
      click(host, 'staff-visit-tip');
      expect(
        [
          ...host.querySelectorAll(
            '[data-testid="staff-visit-tip-tiles"] [aria-checked="true"]',
          ),
        ].map((node) => node.getAttribute('data-testid')),
      ).toEqual(['staff-visit-tip-tile-other']);
      expect(text(host, 'staff-visit-tip-tile-other')).toBe('Друга сума');
      expect(
        (find(host, 'staff-visit-tip-field') as HTMLInputElement).value,
      ).toBe('3,50');
      // Stepping the sum onto a coin's amount does not fold the entry away
      // under the thumb: «Друга сума» stays on, its field reading 5,00,
      // and the 5,00 € coin beside it stays off.
      click(host, 'staff-visit-tip-field-increase');
      click(host, 'staff-visit-tip-field-increase');
      click(host, 'staff-visit-tip-field-increase');
      expect(text(host, 'staff-visit-dock-tip')).toBe('+5,00 € бакшиш');
      expect(
        find(host, 'staff-visit-tip-tile-other')?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        find(host, 'staff-visit-tip-tile-500')?.getAttribute('aria-checked'),
      ).toBe('false');
      expect(
        (find(host, 'staff-visit-tip-field') as HTMLInputElement).value,
      ).toBe('5,00');
      // The coin tile itself is the way to say the preset — it folds the entry.
      click(host, 'staff-visit-tip-tile-500');
      expect(
        find(host, 'staff-visit-tip-tile-500')?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(find(host, 'staff-visit-tip-field')).toBeNull();
      expect(text(host, 'staff-visit-tip-value')).toBe('5,00 €');

      // 14,50 €: the two round-ups lead as large tiles — 0,50 € «общо
      // 15,00 €» and 5,50 € «общо 20,00 €» — then «Без» and the coins 1, 2
      // and 5 € fill a row of four, and «Друга сума» takes the last row.
      host = render(
        visit({
          appointmentId: 'appointment-2',
          rowId: 'appointment-2#ivan',
          priceLabel: '14,50 €',
          priceMinorUnits: 1450,
        }),
      );
      if (find(host, 'staff-visit-tip-section')?.hasAttribute('inert'))
        click(host, 'staff-visit-tip');
      const ids = [
        ...host.querySelectorAll(
          '[data-testid="staff-visit-tip-tiles"] [role="radio"]',
        ),
      ].map((node) => node.getAttribute('data-testid'));
      expect(ids).toEqual([
        'staff-visit-tip-tile-50',
        'staff-visit-tip-tile-550',
        'staff-visit-tip-tile-100',
        'staff-visit-tip-tile-200',
        'staff-visit-tip-tile-500',
        'staff-visit-tip-tile-none',
        'staff-visit-tip-tile-other',
      ]);
      expect(
        find(host, 'staff-visit-tip-tile-50')?.querySelector(
          '.ui-choice-tile__label',
        )?.textContent,
      ).toContain('0,50');
      expect(
        find(host, 'staff-visit-tip-tile-50')?.querySelector(
          '.ui-choice-tile__detail',
        )?.textContent,
      ).toContain('общо 15,00');
      expect(text(host, 'staff-visit-tip-tile-550')).toContain('общо 20,00 €');
      expect(
        find(host, 'staff-visit-tip-tile-200')?.querySelector(
          '.ui-choice-tile__detail',
        ),
      ).toBeNull();

      // 45,00 €: the whole-euro round-up is nothing, the 5 is the bill
      // itself, so «до 50,00 €» leads alone; the coins scale with the bill —
      // 1 € falls under the floor, 5 € is the round-up already, so 2, 10
      // and 20 € take the cells beside and beneath it.
      host = render(
        visit({
          appointmentId: 'appointment-3',
          rowId: 'appointment-3#ivan',
          priceLabel: '45,00 €',
          priceMinorUnits: 4500,
        }),
      );
      if (find(host, 'staff-visit-tip-section')?.hasAttribute('inert'))
        click(host, 'staff-visit-tip');
      expect(
        [
          ...host.querySelectorAll(
            '[data-testid="staff-visit-tip-tiles"] [role="radio"]',
          ),
        ].map((node) => node.getAttribute('data-testid')),
      ).toEqual([
        'staff-visit-tip-tile-500',
        'staff-visit-tip-tile-200',
        'staff-visit-tip-tile-1000',
        'staff-visit-tip-tile-2000',
        'staff-visit-tip-tile-none',
        'staff-visit-tip-tile-other',
      ]);
      expect(text(host, 'staff-visit-tip-tile-500')).toContain('общо 50,00 €');
      expect(text(host, 'staff-visit-tip-tile-1000')).toBe('10,00 €');
    });

    it('withholds the tip row only from a draft and from a visit that is gone', () => {
      // Tomorrow's booking has the row — it just reads «Без».
      expect(
        find(
          render(visit({ dayKey: '2026-08-27', dayLabel: 'чт, 27.08' })),
          'staff-visit-tip',
        ),
      ).not.toBeNull();
      // A visit the server has not seen has nothing to attach a tip to.
      expect(
        find(
          render(visit({ appointmentId: '', rowId: 'new-1' })),
          'staff-visit-tip',
        ),
      ).toBeNull();
      // Cancelled: no money group at all.
      expect(
        find(
          render(visit({ status: 'cancelled', statusLabel: 'Отказан' })),
          'staff-visit-tip',
        ),
      ).toBeNull();
      // A tip already recorded reads back — clearing it is the only way
      // back from a mistyped one. (A new id: the draft is keyed on the
      // visit, and the renders above were all appointment-1.)
      const host = render(
        visit({
          appointmentId: 'appointment-2',
          rowId: 'appointment-2#ivan',
          tipLabel: '5,00 €',
          tipMinorUnits: 500,
        }),
      );
      expect(text(host, 'staff-visit-tip-value')).toBe('5,00 €');
    });

    /*
     * The dock's honesty sentence used to be a second greedy flex child
     * beside the spread primary, which pushed the CTA off the trailing
     * gutter. It takes a line of its own now — a caption ABOUT the sheet,
     * never a control in it — and only this consumer's bar wraps.
     */
    it('shares the bar with nothing but the save', () => {
      const host = render();

      const bar = host.querySelector<HTMLElement>('ui-sheet-action-bar');
      expect(bar?.classList.contains('staff-visit__dock')).toBe(true);
      // Nothing but controls in the dock: the honesty sentence is gone.
      expect(bar?.querySelector('p')).toBeNull();
    });

    /*
     * NOTHING IS DUE ON A VISIT THAT IS GONE (owner, 2026-09-11). «В салона
     * · 9,00 €» is "to be paid at the shop", untrue of a cancelled visit and
     * not to be struck through either — that is a sale tag's "was" price.
     * The dock carries the sheet's one write, and once there is nothing
     * left to save that is the next visit, on the rail where «Запази»
     * lives, hugging the call. The foot loses its duplicate row.
     */
    it('carries the next visit instead of a bill once the visit is gone', () => {
      const host = render(
        visit({
          status: 'cancelled',
          statusLabel: 'Отказан',
          primaryVerb: null,
          overflowVerbs: [],
          resolution: {
            kind: 'cancelled',
            by: 'staff',
            whenLabel: '11:51',
            detail: null,
          },
        }),
      );
      // No bill, no save; the next visit is prominent and last, with the
      // call immediately before it.
      expect(find(host, 'staff-visit-total')).toBeNull();
      expect(find(host, 'staff-visit-save')).toBeNull();
      const rebook = find(host, 'staff-visit-rebook');
      expect(rebook?.closest('ui-sheet-action-bar')).not.toBeNull();
      expect(rebook?.getAttribute('uiButtonStyle')).toBe('borderedProminent');
      expect(rebook?.hasAttribute('data-spread')).toBe(false);
      const controls = [
        ...(host.querySelector('ui-sheet-action-bar')?.children ?? []),
      ];
      expect(controls.at(-1)).toBe(rebook);
      expect(controls.at(-2)).toBe(find(host, 'staff-visit-call'));
      // Nothing left at the foot: cancelled has no correction edge.
      expect(find(host, 'staff-visit-exits')).toBeNull();

      const rebooked: number[] = [];
      fixture.componentInstance.rebooked.subscribe(() => rebooked.push(1));
      click(host, 'staff-visit-rebook');
      expect(rebooked.length).toBe(1);

      // A FINISHED visit keeps its bill: money was owed and paid.
      const done = render(
        visit({
          status: 'completed',
          statusLabel: 'Минал',
          primaryVerb: null,
          overflowVerbs: [],
        }),
      );
      expect(find(done, 'staff-visit-total')).not.toBeNull();
      expect(
        find(done, 'staff-visit-rebook')?.closest('ui-sheet-action-bar'),
      ).toBeNull();
    });
  });

  /*
   * ── A TYPED DURATION ─────────────────────────────────────────────────
   *
   * The menu offered five rungs around the catalogue span, so anything it
   * had not guessed was unreachable. A field reaches every value — and has
   * to defend the two that are real: the five-minute grain the grid draws
   * on, and the floor below which it will not draw at all.
   */
  /*
   * ── THE DISCOUNT ROWS AND THEIR CARD (2026-09-15; recut 2026-09-16, evening) ──
   * What is on the bill is on the LADDER: one row per line in the money
   * group — the kind's glyph, the name over the code and the rule, what it
   * took off beside the way off, a swipe the fast path — then the ladder's
   * own add row, «＋ Добави отстъпка», which whispers the coupon the client
   * holds and raises a CARD inside the sheet, never a page. The card is for
   * ADDING only: «Вид» pinned under its name, and beneath it what the kind
   * needs — the offers as tickets in the catalogue's order, each in one of
   * three states (on offer, applied with «Премахни» in place, blocked and
   * muted), their RULE as the figure; a code typed or scanned; a percent or
   * a sum on a ruler. The lines ride the draft and travel with «Запази»;
   * the foot of the card and the dock say what is still owed.
   */
  /*
   * ── «САЛОН» — THE SHOP ROW (2026-09-18) ──
   * A value row under the people (owner: "maybe under the client section
   * is best") — «Салон» over the shop's name — that UNFOLDS the tip's way
   * into a toolbar
   * with a VIEW PILL (map | list, icon-only) and, beneath it, the DS map by
   * default or the shops as rows (owner: "a location in the main sheet —
   * like the tip, expandable, reusing our map"; then "map only, and a
   * segmented control for toggling map or list view — a toolbar pill with
   * two icons"). A row or a pin drafts the shop; the row above reads it;
   * «Запази» carries it. One shop: no row at all.
   */
  describe('the shop of the visit', () => {
    const SHOPS: readonly VisitEditorShopOption[] = [
      {
        id: 'loc-center',
        label: 'Креативо · Център',
        address: 'бул. „Цар Симеон Велики“ 120',
        lat: 42.4271,
        lng: 25.6366,
      },
      {
        id: 'loc-mladost',
        label: 'Креативо · Младост',
        address: 'ул. „Армейска“ 14',
        lat: 42.46,
        lng: 25.685,
      },
    ];

    function renderShops(vm: VisitEditorVm = visit()): HTMLElement {
      fixture.componentRef.setInput('uiShops', SHOPS);
      return render(vm);
    }

    it('reads the shop on a value row under the chairs — «Салон» over its name, only the disclosure trailing — folded, with no map yet', () => {
      const host = renderShops();
      const row = find(host, 'staff-visit-shop');
      expect(row?.tagName).toBe('BUTTON');
      expect(row?.getAttribute('aria-expanded')).toBe('false');
      expect(row?.getAttribute('aria-haspopup')).toBeNull();
      expect(row?.getAttribute('aria-label')).toBe('Салон: Креативо · Център');
      // The name is the row's own second line (owner: "the location name
      // doesn't make sense trailing — make it the description"), and the
      // trailing rail holds nothing but the chevron.
      const value = find(host, 'staff-visit-shop-value');
      expect(text(host, 'staff-visit-shop-value')).toBe('Креативо · Център');
      expect(value?.closest('ui-stack')).not.toBeNull();
      expect(value?.closest('[uitrailing]')).toBeNull();
      expect(row?.querySelector('[uitrailing] > :not(ui-icon)')).toBeNull();
      expect(find(host, 'staff-visit-shop-address')).toBeNull();
      expect(
        row?.querySelector('ui-icon[data-name="field.expand"]'),
      ).not.toBeNull();
      // UNDER THE PEOPLE (owner, 2026-09-18: "maybe under the client
      // section is best"): after the client and the client's own note,
      // before the team note.
      const group = find(host, 'staff-visit-shop-group');
      expect(group?.previousElementSibling?.getAttribute('data-testid')).toBe(
        'staff-visit-client-note',
      );
      expect(
        group?.nextElementSibling?.contains(find(host, 'staff-visit-add-note')),
      ).toBe(true);
      // Folded: the section is in the segment's tree, inert, and no map
      // has been built for a row nobody opened.
      expect(
        find(host, 'staff-visit-shop-section')?.hasAttribute('inert'),
      ).toBe(true);
      expect(
        row?.closest('.staff-visit__extend')?.hasAttribute('data-open'),
      ).toBe(false);
      expect(host.querySelector('ui-map')).toBeNull();
      expect(find(host, 'staff-visit-save')).toBeNull();
    });

    it('unfolds a view pill over the map; the list behind it drafts the shop on a row, the row reads it, «Запази» carries it', () => {
      const host = renderShops();
      const saved: unknown[] = [];
      fixture.componentInstance.committed.subscribe((commit) =>
        saved.push(commit),
      );
      click(host, 'staff-visit-shop');
      const row = find(host, 'staff-visit-shop');
      expect(row?.getAttribute('aria-expanded')).toBe('true');
      expect(find(host, 'staff-visit-page')).toBeNull();
      const section = find(host, 'staff-visit-shop-section');
      expect(section?.hasAttribute('inert')).toBe(false);
      expect(section?.closest('.staff-visit__extend')).toBe(
        row?.closest('.staff-visit__extend'),
      );
      // THE VIEW PILL floats over the views' box — an icon-only capsule
      // segmented control in thick material, map | list, the map by
      // default — and stays put when the view beneath it changes.
      const pill = find(host, 'staff-visit-shop-view');
      expect(pill?.tagName).toBe('UI-SEGMENTED-CONTROL');
      expect(pill?.getAttribute('data-shape')).toBe('capsule');
      expect(pill?.getAttribute('data-material')).toBe('thick');
      expect(pill?.getAttribute('aria-label')).toBe('Изглед');
      expect(pill?.classList.contains('staff-visit__view-pill')).toBe(true);
      expect(
        pill?.parentElement?.classList.contains('staff-visit__views'),
      ).toBe(true);
      expect(pill?.parentElement?.getAttribute('data-view')).toBe('map');
      expect(pill?.nextElementSibling?.getAttribute('data-testid')).toBe(
        'staff-visit-shop-map',
      );
      const views = [...(pill?.querySelectorAll('[role="radio"]') ?? [])];
      expect(views.map((view) => view.getAttribute('data-testid'))).toEqual([
        'staff-visit-shop-view-map',
        'staff-visit-shop-view-list',
      ]);
      expect(views.map((view) => view.getAttribute('aria-label'))).toEqual([
        'Карта',
        'Списък',
      ]);
      expect(views.every((view) => view.hasAttribute('data-icon-only'))).toBe(
        true,
      );
      expect(
        find(host, 'staff-visit-shop-view-map')?.getAttribute('aria-checked'),
      ).toBe('true');
      // The map mounts on the first unfold, alone under the toolbar, every
      // shop a pin and this one filled; no list yet.
      const box = find(host, 'staff-visit-shop-map');
      expect(box?.hidden).toBe(false);
      expect(box?.querySelector('ui-map')).not.toBeNull();
      expect(find(host, 'staff-visit-shop-list')).toBeNull();
      expect(
        host.querySelector('ui-choice-tiles[data-testid^="staff-visit-shop"]'),
      ).toBeNull();
      const map = fixture.debugElement.query(By.directive(UiMap))
        .componentInstance as UiMap;
      expect(map.uiPins().map((pin) => pin.id)).toEqual([
        'loc-center',
        'loc-mladost',
      ]);
      expect(map.uiSelectedPinId()).toBe('loc-center');
      expect(map.uiSelectedZoom()).toBe(14.5);
      expect(map.uiCooperativeGestures()).toBe(true);
      // The other shop's edge arrow stays on, and the camera keeps the pin
      // and the arrow under the pill's band.
      expect(map.uiOffscreenIndicators()).toBe(true);
      expect(map.uiTopInsetPx()).toBe(52);
      // The place line under the map: the chosen shop's street.
      const place = find(host, 'staff-visit-shop-place');
      expect(place?.hidden).toBe(false);
      expect(text(host, 'staff-visit-shop-place')).toBe(
        'бул. „Цар Симеон Велики“ 120',
      );
      expect(
        place?.querySelector('ui-icon[data-name="location.pin"]'),
      ).not.toBeNull();

      // THE LIST: the shops as rows in the location step's grammar, this
      // one checked; the map stays mounted behind it, hidden.
      click(host, 'staff-visit-shop-view-list');
      expect(
        find(host, 'staff-visit-shop-view-list')?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(pill?.parentElement?.getAttribute('data-view')).toBe('list');
      expect(find(host, 'staff-visit-shop-list')?.parentElement).toBe(
        pill?.parentElement ?? null,
      );
      expect(box?.hidden).toBe(true);
      expect(find(host, 'staff-visit-shop-place')?.hidden).toBe(true);
      expect(box?.querySelector('ui-map')).not.toBeNull();
      const list = find(host, 'staff-visit-shop-list');
      expect(list?.classList.contains('ui-list-group')).toBe(true);
      expect(list?.getAttribute('role')).toBe('radiogroup');
      const rows = [...(list?.querySelectorAll('[role="radio"]') ?? [])];
      expect(rows.map((entry) => entry.getAttribute('data-testid'))).toEqual([
        'staff-visit-shop-loc-center',
        'staff-visit-shop-loc-mladost',
      ]);
      expect(text(host, 'staff-visit-shop-loc-center')).toContain(
        'Креативо · Център',
      );
      expect(text(host, 'staff-visit-shop-loc-center')).toContain(
        'бул. „Цар Симеон Велики“ 120',
      );
      expect(
        find(host, 'staff-visit-shop-loc-center')?.getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        find(host, 'staff-visit-shop-loc-center')?.hasAttribute(
          'data-selected',
        ),
      ).toBe(true);
      expect(
        find(host, 'staff-visit-shop-loc-center')?.querySelector(
          '[uitrailing]',
        ),
      ).not.toBeNull();
      expect(
        find(host, 'staff-visit-shop-loc-mladost')?.querySelector(
          '[uitrailing]',
        ),
      ).toBeNull();

      // A row: the draft takes it, the row above and the map read it, the
      // list stays up, and the dock offers «Запази».
      click(host, 'staff-visit-shop-loc-mladost');
      expect(text(host, 'staff-visit-shop-value')).toBe('Креативо · Младост');
      expect(
        find(host, 'staff-visit-shop-loc-mladost')?.getAttribute(
          'aria-checked',
        ),
      ).toBe('true');
      expect(map.uiSelectedPinId()).toBe('loc-mladost');
      expect(find(host, 'staff-visit-shop-list')).not.toBeNull();
      expect(row?.getAttribute('aria-expanded')).toBe('true');
      expect(find(host, 'staff-visit-save')).not.toBeNull();
      click(host, 'staff-visit-save');
      expect(saved).toHaveLength(1);
      expect((saved[0] as { locationId: string | null }).locationId).toBe(
        'loc-mladost',
      );

      // Back to the map: the same map, the pin moved, the place line the
      // other shop's; the list gone.
      click(host, 'staff-visit-shop-view-map');
      expect(box?.hidden).toBe(false);
      expect(find(host, 'staff-visit-shop-list')).toBeNull();
      expect(find(host, 'staff-visit-shop-place')?.hidden).toBe(false);
      expect(text(host, 'staff-visit-shop-place')).toBe('ул. „Армейска“ 14');

      // Folded on the row's tap; the pick stays.
      click(host, 'staff-visit-shop');
      expect(row?.getAttribute('aria-expanded')).toBe('false');
      expect(
        find(host, 'staff-visit-shop-section')?.hasAttribute('inert'),
      ).toBe(true);
      expect(text(host, 'staff-visit-shop-value')).toBe('Креативо · Младост');
    });

    it('states the shop as a fact on a settled visit, and says nothing where there is one shop', () => {
      const host = renderShops(
        visit({
          status: 'cancelled',
          statusLabel: 'Отказан',
          resolution: { kind: 'cancelledByClient', detail: null },
          primaryVerb: null,
        }),
      );
      const row = find(host, 'staff-visit-shop');
      expect(row?.tagName).toBe('LI');
      expect(text(host, 'staff-visit-shop-value')).toBe('Креативо · Център');
      expect(
        find(host, 'staff-visit-shop-value')?.closest('ui-stack'),
      ).not.toBeNull();
      expect(find(host, 'staff-visit-shop-address')).toBeNull();
      expect(find(host, 'staff-visit-shop-section')).toBeNull();
      // One shop: nothing to choose, nothing said.
      fixture.componentRef.setInput('uiShops', SHOPS.slice(0, 1));
      fixture.detectChanges();
      expect(find(host, 'staff-visit-shop')).toBeNull();
      expect(find(host, 'staff-visit-shop-group')).toBeNull();
    });
  });

  /*
   * ── THE ORDER REVIEW (2026-09-18) ──
   * The owner asked the designer to challenge the sheet's order from the
   * barber's side. The ladder stood; four things moved or grew: the bar
   * names the person, the client's own note sits under the client, the
   * bill sits directly above the exits, and the dock answers instead of
   * vanishing. Empty groups are never drawn; a client without a number
   * says so; a new visit quotes its catalogue sum.
   */
  describe('the order review', () => {
    function mount(vm: VisitEditorVm): {
      fixture: ComponentFixture<StaffVisitEditor>;
      host: HTMLElement;
    } {
      const other = TestBed.createComponent(StaffVisitEditor);
      other.componentRef.setInput('vm', vm);
      other.componentRef.setInput('uiServices', CATALOGUE);
      other.detectChanges();
      return { fixture: other, host: other.nativeElement as HTMLElement };
    }

    it("names the seat's person in the bar — «+1» for a second, the walk-in when nobody is seated, «Нов час» while new, the page's own name on a push", () => {
      const host = render();
      expect(fixture.componentInstance.sheetTitle()).toBe('Мартин Илиев');
      click(host, 'staff-visit-add-service');
      expect(fixture.componentInstance.sheetTitle()).toBe(
        fixture.componentInstance.pageTitle(),
      );
      expect(fixture.componentInstance.pageTitle()).not.toBeNull();
      const party = mount(
        visit({
          people: [
            {
              id: 'user-martin',
              label: 'Мартин Илиев',
              phone: '+359 88 1',
              phoneHref: 'tel:+359881',
              meta: null,
            },
            {
              id: 'guest-1',
              label: 'Иван',
              phone: null,
              phoneHref: null,
              meta: null,
            },
          ],
        }),
      );
      expect(party.fixture.componentInstance.sheetTitle()).toBe(
        'Мартин Илиев +1',
      );
      const walkIn = mount(
        visit({
          clientLabel: '',
          clientUserId: null,
          phone: null,
          phoneHref: null,
        }),
      );
      expect(walkIn.fixture.componentInstance.sheetTitle()).toBe(
        'Случаен клиент',
      );
      const fresh = mount(
        visit({
          appointmentId: '',
          rowId: 'new-1',
          status: 'new',
          primaryVerb: null,
        }),
      );
      expect(fresh.fixture.componentInstance.sheetTitle()).toBe('Нов час');
    });

    it('says «Няма номер» on a client row without a phone, muted, and nothing extra when there is one', () => {
      const host = render(
        visit({ phone: null, phoneHref: null, clientMeta: null }),
      );
      expect(text(host, 'staff-visit-client-no-phone-user-martin')).toBe(
        'Няма номер',
      );
      const other = mount(visit());
      expect(
        other.host.querySelector(
          '[data-testid="staff-visit-client-no-phone-user-martin"]',
        ),
      ).toBeNull();
    });

    it("reads the client's own note under the client, and the bill directly above the exits, after the photos", () => {
      const host = render(
        visit({
          overflowVerbs: [
            { kind: 'cancelled', label: 'Откажи часа', destructive: true },
          ],
        }),
      );
      const quote = find(host, 'staff-visit-client-note');
      expect(
        quote?.previousElementSibling?.classList.contains(
          'staff-visit__group--clients',
        ),
      ).toBe(true);
      const money = find(host, 'staff-visit-money');
      expect(money?.nextElementSibling?.getAttribute('data-testid')).toBe(
        'staff-visit-exits',
      );
      expect(money?.previousElementSibling?.getAttribute('data-testid')).toBe(
        'staff-visit-photos',
      );
      // The team note is its own group, before the photos, after the quote.
      const addNote = find(host, 'staff-visit-add-note');
      expect(
        addNote?.closest('ul')?.nextElementSibling?.getAttribute('data-testid'),
      ).toBe('staff-visit-photos');
    });

    it('offers «Избери услуга» in the dock the moment a party client has no service, and opens the catalogue for that person', () => {
      const host = render(
        visit({
          people: [
            {
              id: 'user-martin',
              label: 'Мартин Илиев',
              phone: '+359 88 1',
              phoneHref: 'tel:+359881',
              meta: null,
            },
            {
              id: 'guest-1',
              label: 'Иван',
              phone: null,
              phoneHref: null,
              meta: null,
            },
          ],
          legs: [
            {
              seatId: 'seat-cut',
              serviceId: 'cut',
              variantId: null,
              serviceLabel: 'Класическо подстригване',
              minutes: 30,
              priceLabel: '20,00 €',
              barberId: 'ivan',
              barberName: 'Иван',
              barberTone: 0,
              overridden: false,
              clientId: 'user-martin',
            },
          ],
        }),
      );
      // Clean, yet Иван has no service: the slot says so at once (owner,
      // 2026-09-24) — dirty or not, and no footnote up the ladder.
      expect(find(host, 'staff-visit-save')).toBeNull();
      expect(find(host, 'staff-visit-needs-service')).toBeNull();
      const choose = find(host, 'staff-visit-choose-service');
      expect(choose?.closest('ui-sheet-action-bar')).not.toBeNull();
      expect(choose?.hasAttribute('disabled')).toBe(false);
      expect(text(host, 'staff-visit-choose-service')).toBe('Избери услуга');

      // The catalogue opens FOR Иван, and its picks seat for him.
      click(host, 'staff-visit-choose-service');
      expect(find(host, 'staff-visit-page')?.getAttribute('data-page')).toBe(
        'service',
      );
      expect(text(host, 'staff-visit-services-for')).toBe('За Иван');
      click(host, 'staff-visit-service-fade');
      click(host, 'staff-visit-service-apply');
      expect(find(host, 'staff-visit-page')).toBeNull();
      expect(find(host, 'staff-visit-choose-service')).toBeNull();
      expect(find(host, 'staff-visit-save')).not.toBeNull();
      const commits: { legs: { serviceId: string; clientId: string }[] }[] = [];
      fixture.componentInstance.committed.subscribe((c) =>
        commits.push(c as unknown as (typeof commits)[number]),
      );
      click(host, 'staff-visit-save');
      expect(
        commits[0]?.legs.map((leg) => [leg.serviceId, leg.clientId]),
      ).toEqual([
        ['cut', 'user-martin'],
        ['fade', 'guest-1'],
      ]);
    });

    it("shows the person's number and no last-visit badge on the sheet", () => {
      // The search needs «посл. …» to tell two people apart; once chosen,
      // the row is a fact about THIS visit (owner, 2026-09-24).
      const host = render(
        visit({
          people: [
            {
              id: 'user-martin',
              label: 'Мартин Илиев',
              phone: '+359 88 1',
              phoneHref: 'tel:+359881',
              meta: 'посл. 3 авг',
            },
          ],
        }),
      );
      const row = host.querySelector(
        '[data-testid^="staff-visit-client-row-"]',
      );
      expect(row?.textContent).toContain('+359 88 1');
      expect(row?.textContent).not.toContain('посл.');
      expect(row?.querySelector('.ui-badge')).toBeNull();

      // The person's page keeps that line under the name — and not the
      // number, which its call row already prints (2026-09-24).
      (row as HTMLElement).click();
      fixture.detectChanges();
      const title = host.querySelector('#staff-visit-page-title');
      expect(title?.closest('ui-sheet-headline')).not.toBeNull();
      expect(text(host, 'staff-visit-client-meta')).toBe('посл. 3 авг');
      expect(text(host, 'staff-visit-client-call')).toContain('+359 88 1');
    });

    it("quotes a new visit's catalogue sum in the dock, «По каталог», and draws no bill group and no photos for it", () => {
      const host = render(
        visit({
          appointmentId: '',
          rowId: 'new-1',
          status: 'new',
          primaryVerb: null,
          priceLabel: null,
          priceMinorUnits: null,
        }),
      );
      const total = find(host, 'staff-visit-total');
      expect(total?.firstElementChild?.textContent?.trim()).toBe('По каталог');
      expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');
      expect(find(host, 'staff-visit-money')).toBeNull();
      expect(find(host, 'staff-visit-photos')).toBeNull();
    });

    it('draws no hollow note or photo group on a settled visit that has neither', () => {
      const host = render(
        visit({
          status: 'cancelled',
          statusLabel: 'Отказан',
          resolution: { kind: 'cancelledByClient', detail: null },
          primaryVerb: null,
        }),
      );
      expect(find(host, 'staff-visit-add-note')).toBeNull();
      expect(find(host, 'staff-visit-note-field')).toBeNull();
      expect(find(host, 'staff-visit-photos')).toBeNull();
      expect(find(host, 'staff-visit-money')).toBeNull();
    });
  });

  /*
   * ── THE ADD-CLIENT PAGE (redesigned 2026-09-18) ──
   * One question — who is coming — in three states of the search: the
   * owner's SECTIONS before anything is typed (or a hint), the results
   * while typing, and a CREATE row first that reads what was typed. The
   * picked people ride as chips under the search; the dock counts them and
   * keeps ✓ as the way back.
   */
  describe('the add-client page', () => {
    const SECTIONS: readonly VisitEditorClientSection[] = [
      {
        id: 'frequent',
        title: 'Чести',
        clients: [
          {
            id: 'user-petar',
            label: 'Петър Ганев',
            phone: '+359 88 2',
            phoneHref: 'tel:+359882',
            meta: '11 посещения',
          },
        ],
      },
      {
        id: 'recent',
        title: 'Скорошни',
        clients: [
          {
            id: 'user-martin',
            label: 'Мартин Илиев',
            phone: '+359 88 1',
            phoneHref: 'tel:+359881',
            meta: 'посл. 3 авг',
          },
          {
            id: 'user-anna',
            label: 'Анна Костова',
            phone: null,
            phoneHref: null,
            meta: null,
          },
        ],
      },
    ];

    it("offers the sections before a search, «Нов клиент» in the dock, the visit's own person in «На посещението» and not a suggestion", () => {
      fixture.componentRef.setInput('uiClientSections', SECTIONS);
      const host = render();
      click(host, 'staff-visit-add-client');
      // «Нов клиент» is the dock's (owner, 2026-09-22), beside the ✓ — no
      // row for it ahead of the sections.
      expect(find(host, 'staff-visit-new-client')).toBeNull();
      const dockAdd = find(host, 'staff-visit-new-client-dock');
      expect(dockAdd?.closest('ui-sheet-action-bar')).not.toBeNull();
      expect(dockAdd?.getAttribute('aria-label')).toBe('Нов клиент');
      expect(find(host, 'staff-visit-page-done')).not.toBeNull();
      // The sections, in the owner's order, each under its footnote.
      const frequent = find(host, 'staff-visit-clients-frequent');
      expect(frequent?.firstElementChild?.textContent?.trim()).toBe('Чести');
      expect(
        frequent?.querySelector(
          '[data-testid="staff-visit-client-user-petar"]',
        ),
      ).not.toBeNull();
      // The owner's own line rides its glyph under the number.
      expect(
        find(host, 'staff-visit-client-user-petar')
          ?.querySelector('.staff-event-head__line:last-child ui-icon')
          ?.getAttribute('data-name'),
      ).toBe('visit.last');
      const recent = find(host, 'staff-visit-clients-recent');
      // Мартин is on the visit already: a selected row of «На посещението»,
      // the group under the field, and NOT a row in «Скорошни» — a person
      // already on the visit is no suggestion (owner, 2026-09-22: no
      // repetition of the picked).
      expect(find(host, 'staff-visit-client-user-martin')).toBeNull();
      expect(recent?.querySelectorAll('[role="checkbox"]').length).toBe(1);
      const picked = find(host, 'staff-visit-picked');
      expect(picked?.firstElementChild?.textContent?.trim()).toBe(
        'На посещението',
      );
      expect(
        find(host, 'staff-visit-picked-user-martin')?.getAttribute(
          'aria-checked',
        ),
      ).toBe('true');
      expect(
        find(host, 'staff-visit-picked-user-martin')
          ?.querySelector('.ui-avatar__fallback')
          ?.textContent?.trim(),
      ).toBe('МИ');
      expect(text(host, 'staff-visit-clients-count-figure')).toBe('1');
      expect(find(host, 'staff-visit-search-hint')).toBeNull();
      // No «Няма съвпадение» for a search nobody ran.
      expect(host.textContent).not.toContain('Няма съвпадение');
    });

    it('shows a quiet hint with nothing to suggest, and never a dead end while typing: the create row reads the query', () => {
      const host = render();
      click(host, 'staff-visit-add-client');
      expect(find(host, 'staff-visit-search-hint')).not.toBeNull();
      expect(text(host, 'staff-visit-search-hint')).toContain(
        'Търси по име или телефон',
      );
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      query.value = 'Мария';
      query.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(find(host, 'staff-visit-search-hint')).toBeNull();
      // The create row says what it will assign: the name, with its glyph.
      expect(text(host, 'staff-visit-new-client-name')).toBe('Мария');
      expect(
        find(host, 'staff-visit-new-client')?.getAttribute('aria-label'),
      ).toBe('Нов клиент: Мария');
      expect(find(host, 'staff-visit-new-client-phone')).toBeNull();
      expect(host.textContent).not.toContain('Няма съвпадение');
      click(host, 'staff-visit-new-client');
      expect(find(host, 'staff-visit-page')?.dataset['page']).toBe('clientNew');
      expect(
        (find(host, 'staff-visit-new-name') as HTMLInputElement).value,
      ).toBe('Мария');
    });

    it('moves a person from a section up into «На посещението», and a tap there puts them back', () => {
      fixture.componentRef.setInput('uiClientSections', SECTIONS);
      const host = render();
      click(host, 'staff-visit-add-client');
      click(host, 'staff-visit-client-user-petar');
      // Picked: a row of the group now, no longer a suggestion; the count follows.
      expect(find(host, 'staff-visit-client-user-petar')).toBeNull();
      expect(
        find(host, 'staff-visit-picked-user-petar')?.getAttribute(
          'aria-checked',
        ),
      ).toBe('true');
      expect(text(host, 'staff-visit-clients-count-figure')).toBe('2');
      click(host, 'staff-visit-picked-user-petar');
      expect(find(host, 'staff-visit-picked-user-petar')).toBeNull();
      expect(
        find(host, 'staff-visit-client-user-petar')?.getAttribute(
          'aria-checked',
        ),
      ).toBe('false');
      expect(text(host, 'staff-visit-clients-count-figure')).toBe('1');
    });

    it("shows a person's own portrait when they have one, and reads a typed number as the new client's", () => {
      fixture.componentRef.setInput('uiClientSections', [
        {
          id: 'recent',
          title: 'Скорошни',
          clients: [
            {
              id: 'user-anna',
              label: 'Анна Костова',
              phone: '+359 88 5',
              phoneHref: 'tel:+359885',
              meta: null,
              avatarSrc: '/avatars/anna.jpg',
            },
            {
              id: 'user-petar',
              label: 'Петър Ганев',
              phone: null,
              phoneHref: null,
              meta: null,
            },
          ],
        },
      ]);
      const host = render();
      click(host, 'staff-visit-add-client');
      expect(
        find(host, 'staff-visit-client-user-anna')
          ?.querySelector('ui-avatar img')
          ?.getAttribute('src'),
      ).toBe('/avatars/anna.jpg');
      expect(
        find(host, 'staff-visit-client-user-petar')?.querySelector(
          'ui-avatar img',
        ),
      ).toBeNull();
      expect(
        find(host, 'staff-visit-client-user-petar')
          ?.querySelector('.ui-avatar__fallback')
          ?.textContent?.trim(),
      ).toBe('ПГ');
      // Picked, a person keeps their face in «На посещението» (owner,
      // 2026-09-22); one without a portrait wears their monogram there too.
      click(host, 'staff-visit-client-user-anna');
      expect(
        find(host, 'staff-visit-picked-user-anna')
          ?.querySelector('ui-avatar img')
          ?.getAttribute('src'),
      ).toBe('/avatars/anna.jpg');
      click(host, 'staff-visit-client-user-petar');
      expect(
        find(host, 'staff-visit-picked-user-petar')
          ?.querySelector('.ui-avatar__fallback')
          ?.textContent?.trim(),
      ).toBe('ПГ');
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      query.value = '0887654321';
      query.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      // A number, read as one and printed the profile's way once whole.
      expect(text(host, 'staff-visit-new-client-phone')).toBe(
        '+359 88 765 4321',
      );
      expect(find(host, 'staff-visit-new-client-name')).toBeNull();
      expect(
        find(host, 'staff-visit-client-query-glyph')?.getAttribute('data-kind'),
      ).toBe('phone');
      click(host, 'staff-visit-new-client');
      expect(find(host, 'staff-visit-page')?.dataset['page']).toBe('clientNew');
      expect(
        (find(host, 'staff-visit-new-name') as HTMLInputElement).value,
      ).toBe('');
    });

    it('matches a number typed the way it is dialled against the stored international form', () => {
      // `user-marto`, not the visit's own `user-martin`: a person already on
      // the visit is answered by his own group, never by the results.
      fixture.componentRef.setInput('uiClients', [
        {
          id: 'user-marto',
          label: 'Мартин Илиев',
          phone: '+359 88 765 4321',
          phoneHref: 'tel:+359887654321',
          meta: null,
        },
        {
          id: 'user-anna',
          label: 'Анна Костова',
          phone: '+359 88 500 0000',
          phoneHref: 'tel:+359885000000',
          meta: null,
        },
      ]);
      const host = render();
      click(host, 'staff-visit-add-client');
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      for (const [typed, expected] of [
        ['088 765', ['user-marto']],
        ['0887654321', ['user-marto']],
        ['+359 88 765', ['user-marto']],
        ['885', ['user-anna']],
      ] as const) {
        query.value = typed;
        query.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        const ids = [
          ...host.querySelectorAll(
            '[data-testid="staff-visit-client-results"] [role="checkbox"]',
          ),
        ].map((row) =>
          row.getAttribute('data-testid')?.replace('staff-visit-client-', ''),
        );
        expect(ids, typed).toEqual(expected);
      }
    });

    it("opens the form on the shop's own country every time — a pick made for one person is not the next one's", () => {
      const host = render();
      click(host, 'staff-visit-add-client');
      click(host, 'staff-visit-new-client-dock');
      const editor = fixture.componentInstance as unknown as {
        newClientCountry: { (): string | undefined; set(value: string): void };
        pop(): void;
      };
      expect(editor.newClientCountry()).toBe('BG');
      editor.newClientCountry.set('AZ');
      editor.pop();
      fixture.detectChanges();
      click(host, 'staff-visit-new-client-dock');
      expect(editor.newClientCountry()).toBe('BG');
    });

    it('finds every part of a pasted line and opens the form with all three in place', () => {
      const host = render();
      click(host, 'staff-visit-add-client');
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      query.value = 'Мария Иванова 088 765 4321 <maria@mail.bg>';
      query.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(
        find(host, 'staff-visit-client-query-glyph')?.getAttribute('data-kind'),
      ).toBe('email');
      expect(text(host, 'staff-visit-new-client-name')).toBe('Мария Иванова');
      expect(text(host, 'staff-visit-new-client-phone')).toBe(
        '+359 88 765 4321',
      );
      expect(text(host, 'staff-visit-new-client-email')).toBe('maria@mail.bg');
      click(host, 'staff-visit-new-client');
      expect(
        (find(host, 'staff-visit-new-name') as HTMLInputElement).value,
      ).toBe('Мария Иванова');
      expect(
        (find(host, 'staff-visit-new-email') as HTMLInputElement).value,
      ).toBe('maria@mail.bg');
    });

    it('ranks and marks the hits; the create row leads every search, yielding only to an exact match', () => {
      fixture.componentRef.setInput('uiClients', [
        {
          id: 'user-maria',
          label: 'Мария Мартинова',
          phone: null,
          phoneHref: null,
          meta: null,
        },
        {
          id: 'user-marto',
          label: 'Мартин Илиев',
          phone: '+359 88 765 4321',
          phoneHref: 'tel:+359887654321',
          meta: 'martin@test.local',
          email: 'martin@test.local',
        },
      ]);
      const host = render();
      click(host, 'staff-visit-add-client');
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      const type = (value: string) => {
        query.value = value;
        query.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      };
      // The create row stands in a group of its own (owner, 2026-09-22),
      // before or after the people's — read both in document order.
      const order = () =>
        [
          ...host.querySelectorAll(
            '[data-testid="staff-visit-create-group"] > li > [data-testid], [data-testid="staff-visit-client-results"] > li > [data-testid]',
          ),
        ].map((row) => row.getAttribute('data-testid'));
      expect(find(host, 'staff-visit-create-group')).toBeNull();
      // Nothing typed, and this owner hands the page people already (the
      // party fixtures do): they list; «Нов клиент» is the dock's.
      expect(order()).toEqual([
        'staff-visit-client-user-maria',
        'staff-visit-client-user-marto',
      ]);
      // A name: the create row FIRST — always visible while a search is on
      // (owner, 2026-09-22) — then first-name matches, the typed run heavy.
      type('март');
      expect(order()).toEqual([
        'staff-visit-new-client',
        'staff-visit-client-user-marto',
        'staff-visit-client-user-maria',
      ]);
      const hits = [
        ...(find(host, 'staff-visit-client-user-marto')?.querySelectorAll(
          '.staff-event-head__hit',
        ) ?? []),
      ].map((node) => node.textContent);
      expect(hits).toEqual(['Март']);
      // Nobody matches: the row IS the answer — never a dead end.
      type('Никол');
      expect(order()).toEqual(['staff-visit-new-client']);
      // A whole number that is already somebody's: they lead, badged, and
      // the row steps behind them — still there, a parent and a child can
      // share a phone.
      type('0887654321');
      expect(order()).toEqual([
        'staff-visit-client-user-marto',
        'staff-visit-new-client',
      ]);
      expect(text(host, 'staff-visit-client-exact-user-marto')).toBe(
        'Вече е клиент',
      );
      expect(
        [
          ...(find(host, 'staff-visit-client-user-marto')?.querySelectorAll(
            '.staff-event-head__hit',
          ) ?? []),
        ].map((node) => node.textContent),
      ).toEqual(['359 88 765 4321']);
      // EVERY FACT ON ITS OWN GLYPH-LED LINE (owner, 2026-09-22) — the mail,
      // then the number, the agenda card's order — never one dotted string.
      const lines = () =>
        [
          ...(find(host, 'staff-visit-client-user-marto')?.querySelectorAll(
            '.staff-event-head__line',
          ) ?? []),
        ].map((line) => ({
          icon: line.querySelector('ui-icon')?.getAttribute('data-name'),
          text: line
            .querySelector('.staff-event-head__text')
            ?.textContent?.trim(),
        }));
      expect(lines()).toEqual([
        { icon: 'contact.email', text: 'martin@test.local' },
        { icon: 'contact.phone', text: '+359 88 765 4321' },
      ]);
      // A mail found by its own letters is marked on ITS line.
      type('martin@te');
      expect(
        [
          ...(find(host, 'staff-visit-client-user-marto')?.querySelectorAll(
            '.staff-event-head__hit',
          ) ?? []),
        ].map((node) => node.textContent),
      ).toEqual(['martin@te']);
    });

    it("reads a typed number as the shop's international one before it is whole", () => {
      const host = render();
      click(host, 'staff-visit-add-client');
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      const type = (value: string) => {
        query.value = value;
        query.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      };
      // The trunk zero becomes «+359» as it is typed (owner, 2026-09-22).
      type('088 76');
      expect(text(host, 'staff-visit-new-client-phone')).toBe('+359 88 76');
      // A code typed stays the code typed.
      type('+44 20 7946');
      expect(text(host, 'staff-visit-new-client-phone')).toBe('+44 20 7946');
      // Whole, it prints the way the profile prints it and opens the form
      // with the E.164 in front of the field.
      type('0887654321');
      expect(text(host, 'staff-visit-new-client-phone')).toBe(
        '+359 88 765 4321',
      );
    });

    it('takes Return as the answer: the one match onto the visit, or the form when nobody matches', () => {
      fixture.componentRef.setInput('uiClients', [
        {
          id: 'user-petar',
          label: 'Петър Ганев',
          phone: '+359 88 222 3344',
          phoneHref: 'tel:+359882223344',
          meta: null,
        },
      ]);
      const host = render();
      click(host, 'staff-visit-add-client');
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      const type = (value: string) => {
        query.value = value;
        query.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      };
      const enter = () => {
        query.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          }),
        );
        fixture.detectChanges();
      };
      type('0882223');
      enter();
      expect(find(host, 'staff-visit-picked-user-petar')).not.toBeNull();
      expect(fixture.componentInstance.query()).toBe('');
      type('Никой Никоев');
      enter();
      expect(find(host, 'staff-visit-page')?.dataset['page']).toBe('clientNew');
      expect(
        (find(host, 'staff-visit-new-name') as HTMLInputElement).value,
      ).toBe('Никой Никоев');
    });

    it('answers from the book on the keystroke, and keeps those rows in place when the index lands', () => {
      fixture.componentRef.setInput('uiClients', []);
      fixture.componentRef.setInput('uiClientSections', [
        {
          id: 'today',
          title: 'Днес',
          clients: [
            {
              id: 'user-kiril',
              label: 'Кирил Тодоров',
              phone: '+359 88 444 5566',
              phoneHref: 'tel:+359884445566',
              meta: '11:00',
              email: 'kiril@test.local',
            },
          ],
        },
      ]);
      fixture.componentRef.setInput('uiClientBook', [
        {
          id: 'user-kiril',
          label: 'Кирил Тодоров',
          phone: '+359 88 444 5566',
          phoneHref: 'tel:+359884445566',
          meta: null,
          email: 'kiril@test.local',
        },
        {
          id: 'user-kina',
          label: 'Кина Кирова',
          phone: '+359 88 000 1122',
          phoneHref: 'tel:+359880001122',
          meta: null,
        },
      ]);
      const host = render();
      click(host, 'staff-visit-add-client');
      const ids = () =>
        [
          ...host.querySelectorAll(
            '[data-testid="staff-visit-client-results"] [role="checkbox"]',
          ),
        ].map((row) =>
          row.getAttribute('data-testid')?.replace('staff-visit-client-', ''),
        );
      // Nothing typed: the book is never LISTED — only the sections are.
      expect(ids()).toEqual([]);
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      const type = (value: string) => {
        query.value = value;
        query.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      };
      // By mail, by number, by name — with no answer from the index at all.
      type('kiril@');
      expect(ids()).toEqual(['user-kiril']);
      type('0884445566');
      expect(ids()).toEqual(['user-kiril']);
      expect(text(host, 'staff-visit-client-exact-user-kiril')).toBe(
        'Вече е клиент',
      );
      type('ки');
      expect(ids()).toEqual(['user-kiril', 'user-kina']);
      // The index lands: a new person joins BELOW, the book's rows stay put,
      // and the profile's fields replace the snapshot's.
      fixture.componentRef.setInput('uiClients', [
        {
          id: 'user-kircho',
          label: 'Кирчо Ненов',
          phone: null,
          phoneHref: null,
          meta: null,
        },
        {
          id: 'user-kina',
          label: 'Кина Кирова-Димова',
          phone: '+359 88 000 1122',
          phoneHref: 'tel:+359880001122',
          meta: null,
        },
      ]);
      fixture.detectChanges();
      expect(ids()).toEqual(['user-kiril', 'user-kina', 'user-kircho']);
      expect(find(host, 'staff-visit-client-user-kina')?.textContent).toContain(
        'Кина Кирова-Димова',
      );
    });

    it('makes Return wait for the index rather than race it, unless the match is exact', () => {
      fixture.componentRef.setInput('uiClients', []);
      fixture.componentRef.setInput('uiClientBook', [
        {
          id: 'user-marto',
          label: 'Мартин Илиев',
          phone: '+359 88 765 4321',
          phoneHref: 'tel:+359887654321',
          meta: null,
        },
      ]);
      const host = render();
      click(host, 'staff-visit-add-client');
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      const type = (value: string) => {
        query.value = value;
        query.dispatchEvent(new Event('input'));
        fixture.detectChanges();
      };
      const enter = () => {
        query.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          }),
        );
        fixture.detectChanges();
      };
      // The book's one «Мартин» may be one of three: Return waits.
      fixture.componentRef.setInput('uiClientSearching', true);
      type('март');
      enter();
      expect(find(host, 'staff-visit-picked-user-marto')).toBeNull();
      // The index answers with a second one — nobody is picked for the desk.
      fixture.componentRef.setInput('uiClients', [
        {
          id: 'user-martina',
          label: 'Мартина Колева',
          phone: null,
          phoneHref: null,
          meta: null,
        },
      ]);
      fixture.componentRef.setInput('uiClientSearching', false);
      fixture.detectChanges();
      expect(find(host, 'staff-visit-picked-user-marto')).toBeNull();
      expect(fixture.componentInstance.query()).toBe('март');
      // A whole number is somebody's whatever the index says: no waiting.
      fixture.componentRef.setInput('uiClientSearching', true);
      type('0887654321');
      enter();
      expect(find(host, 'staff-visit-picked-user-marto')).not.toBeNull();
      // And a wait that ends with the one match still standing picks them.
      fixture.componentRef.setInput('uiClients', []);
      fixture.componentRef.setInput('uiClientBook', [
        {
          id: 'user-petar',
          label: 'Петър Ганев',
          phone: null,
          phoneHref: null,
          meta: null,
        },
      ]);
      type('петър');
      enter();
      expect(find(host, 'staff-visit-picked-user-petar')).toBeNull();
      fixture.componentRef.setInput('uiClientSearching', false);
      fixture.detectChanges();
      expect(find(host, 'staff-visit-picked-user-petar')).not.toBeNull();
    });

    it('turns a quiet ring in the field while the owner is looking somebody up', () => {
      const host = render();
      click(host, 'staff-visit-add-client');
      expect(find(host, 'staff-visit-client-searching')).toBeNull();
      fixture.componentRef.setInput('uiClientSearching', true);
      fixture.detectChanges();
      expect(find(host, 'staff-visit-client-searching')?.tagName).toBe(
        'UI-PROGRESS-VIEW',
      );
    });

    it('folds the large title while the search is engaged — focused, or holding a query', () => {
      const host = render();
      click(host, 'staff-visit-add-client');
      const editor = fixture.componentInstance;
      const headline = () =>
        find(host, 'staff-visit-client-headline')?.hasAttribute('data-folded');
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      expect(editor.searchEngaged()).toBe(false);
      expect(headline()).toBe(false);
      // Focus alone folds it: the field rises under the bar before a key lands.
      query.dispatchEvent(new Event('focus'));
      fixture.detectChanges();
      expect(editor.searchEngaged()).toBe(true);
      expect(headline()).toBe(true);
      // Leaving the field EMPTY brings it back…
      query.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      expect(headline()).toBe(false);
      // …but a query still standing is a list still being read.
      query.dispatchEvent(new Event('focus'));
      query.value = 'март';
      query.dispatchEvent(new Event('input'));
      query.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      expect(headline()).toBe(true);
      // Back at the root nothing is engaged; a page re-opened starts unfolded.
      query.dispatchEvent(new Event('focus'));
      fixture.detectChanges();
      editor.pop();
      fixture.detectChanges();
      expect(editor.searchEngaged()).toBe(false);
      click(host, 'staff-visit-add-client');
      expect(editor.searchEngaged()).toBe(false);
      expect(
        find(host, 'staff-visit-client-headline')?.hasAttribute('data-folded'),
      ).toBe(false);
    });

    it("opens at its own top: the SHEET's scroller goes back to zero, not only the host", () => {
      const host = render();
      // The sheet owns the scrolling; the editor is a child of its scroller.
      const sheet = document.createElement('ui-sheet');
      const scroller = document.createElement('div');
      sheet.append(scroller);
      host.parentElement?.append(sheet);
      scroller.append(host);
      scroller.scrollTop = 50;
      expect(scroller.scrollTop).toBe(50);
      click(host, 'staff-visit-add-client');
      expect(scroller.scrollTop).toBe(0);
    });

    it('tells the owner the page opened, so the sections can be loaded', () => {
      const host = render();
      let browsed = 0;
      fixture.componentInstance.clientsBrowsed.subscribe(() => browsed++);
      click(host, 'staff-visit-add-client');
      expect(browsed).toBe(1);
    });
  });

  describe('the photos of the visit', () => {
    // Owner, 2026-09-17: "attach / take pictures to an appointment, with
    // meta on them: who — barber, client, appointment".
    const PHOTOS: readonly VisitEditorPhoto[] = [
      {
        photoId: 'p-1',
        barberId: 'ivan',
        url: 'https://cdn/p1.jpg',
        takenAtIso: '2026-08-26T09:05:00.000Z',
        barberName: 'Иван Колев',
        clientLabel: 'Георги Петров',
        width: 1600,
        height: 1200,
        origin: 'shot',
        label: null,
      },
      {
        photoId: 'p-2',
        barberId: 'gone',
        url: 'https://cdn/p2.jpg',
        takenAtIso: '2026-08-26T09:40:00.000Z',
        barberName: null,
        clientLabel: 'Георги Петров',
        width: null,
        height: null,
        origin: 'shot',
        label: null,
      },
    ];
    /** One of the shop's own pictures, pointed at from the gallery page. */
    const ADOPTED: VisitEditorPhoto = {
      photoId: 'p-3',
      barberId: 'ivan',
      url: '/work/modern-cut.jpg',
      takenAtIso: '2026-08-26T10:00:00.000Z',
      barberName: 'Иван Колев',
      clientLabel: 'Георги Петров',
      width: null,
      height: null,
      origin: 'library',
      label: 'Модерна визия',
    };
    const LIBRARY = [
      {
        id: 'svc-cut:0',
        url: '/work/scissors-trim.jpg',
        path: '/work/scissors-trim.jpg',
        label: 'Подстригване',
      },
      {
        id: 'svc-fade:1',
        url: '/work/fade-styling.jpg',
        path: '/work/fade-styling.jpg',
        label: 'Фейд',
      },
    ];
    /** A door in the open menu, by its test id. */
    const pickDoor = (host: HTMLElement, testId: string) => {
      const door = host.querySelector<HTMLElement>(
        `ui-menu[data-open] [data-testid="${testId}"]`,
      );
      if (door === null) throw new Error(`no door ${testId}`);
      door.click();
      fixture.detectChanges();
    };
    /** The sheet's own clock for a photo — the same formatter, so the host's zone cannot fail the test. */
    const when = (iso: string) =>
      new Intl.DateTimeFormat('bg-BG', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso));

    it('shows the pictures taken as a grid under the note, each a door, and the add row over a bare image input', () => {
      const host = render(visit({ photos: PHOTOS }));
      const group = find(host, 'staff-visit-photos');
      expect(group?.classList.contains('ui-list-group')).toBe(true);
      expect(
        group?.previousElementSibling?.contains(
          find(host, 'staff-visit-add-note'),
        ),
      ).toBe(true);
      const doors = [
        ...(find(host, 'staff-visit-photo-grid')?.querySelectorAll('button') ??
          []),
      ];
      expect(doors.map((door) => door.getAttribute('data-testid'))).toEqual([
        'staff-visit-photo-p-1',
        'staff-visit-photo-p-2',
      ]);
      expect(doors[0]?.getAttribute('aria-label')).toBe(
        `Снимка от ${when(PHOTOS[0]!.takenAtIso)}`,
      );
      const thumb = doors[0]?.querySelector('ui-async-image');
      expect(thumb?.getAttribute('style')).toContain('aspect-ratio');
      expect(
        thumb?.querySelector('img')?.getAttribute('src') ??
          thumb?.getAttribute('ng-reflect-ui-src') ??
          'https://cdn/p1.jpg',
      ).toContain('p1.jpg');
      // The add row: the note's own grammar, and its doors in the DS choice
      // menu — the chair's and «Вид»'s own (owner, 2026-09-17: "why is it
      // not using our ui menu the other dropdowns are using?"): the
      // camera, the phone's pictures, the shop's. The phone's picker is
      // one hidden input at the root, reached from the «От устройството»
      // door inside its own tap.
      fixture.componentRef.setInput('uiCamera', true);
      fixture.detectChanges();
      const add = find(host, 'staff-visit-add-photo') as HTMLButtonElement;
      expect(add.tagName).toBe('BUTTON');
      expect(add.disabled).toBe(false);
      expect(add.getAttribute('aria-haspopup')).toBe('menu');
      expect(
        add.querySelector('[uileading] ui-icon[data-name="action.add"]'),
      ).not.toBeNull();
      click(host, 'staff-visit-add-photo');
      const menu = host.querySelector('ui-menu[data-open]');
      expect(menu?.querySelector('ui-list-group')).not.toBeNull();
      const menuDoors = [
        ...(menu?.querySelectorAll(
          '[role="menuitemradio"], [role="menuitem"]',
        ) ?? []),
      ];
      expect(menuDoors.map((door) => door.getAttribute('data-testid'))).toEqual(
        [
          'staff-visit-photo-take',
          'staff-visit-photo-upload',
          'staff-visit-photo-system',
        ],
      );
      expect(menuDoors[0]?.classList.contains('ui-list-row')).toBe(true);
      expect(text(host, 'staff-visit-photo-take')).toBe('Снимай');
      expect(
        menuDoors[0]?.querySelector('ui-icon[data-name="media.camera"]'),
      ).not.toBeNull();
      expect(text(host, 'staff-visit-photo-upload')).toBe('От устройството');
      expect(
        menuDoors[1]?.querySelector('ui-icon[data-name="media.library"]'),
      ).not.toBeNull();
      expect(text(host, 'staff-visit-photo-system')).toBe('От галерията');
      expect(
        menuDoors[2]?.querySelector('ui-icon[data-name="media.gallery"]'),
      ).not.toBeNull();
      const library = find(
        host,
        'staff-visit-photo-library',
      ) as HTMLInputElement;
      expect(library.type).toBe('file');
      expect(library.getAttribute('accept')).toBe('image/*');
      expect(library.hasAttribute('multiple')).toBe(true);
      expect(library.hidden).toBe(true);
      const opened = vi.spyOn(library, 'click');
      pickDoor(host, 'staff-visit-photo-upload');
      expect(opened).toHaveBeenCalledTimes(1);
      expect(host.querySelector('ui-menu[data-open]')).toBeNull();
      // No camera to ask for: that door is not offered.
      fixture.componentRef.setInput('uiCamera', false);
      fixture.detectChanges();
      click(host, 'staff-visit-add-photo');
      expect(
        host.querySelector(
          'ui-menu[data-open] [data-testid="staff-visit-photo-take"]',
        ),
      ).toBeNull();
      expect(
        host.querySelector(
          'ui-menu[data-open] [data-testid="staff-visit-photo-system"]',
        ),
      ).not.toBeNull();
      pickDoor(host, 'staff-visit-photo-system');
      fixture.componentInstance.pop();
      fixture.detectChanges();
      // Nothing taken yet: the add row alone.
      const bare = render(
        visit({ appointmentId: 'appointment-2', rowId: 'appointment-2#ivan' }),
      );
      expect(find(bare, 'staff-visit-photo-grid')).toBeNull();
      expect(find(bare, 'staff-visit-add-photo')).not.toBeNull();
    });

    it('turns its ring while a photo is on its way, keeps the pictures of a visit that is gone without the add row, and hangs nothing on a draft', () => {
      const busy = render(visit({ photos: PHOTOS, photoBusy: true }));
      const add = find(busy, 'staff-visit-add-photo') as HTMLButtonElement;
      expect(add.disabled).toBe(true);
      expect(add.getAttribute('aria-busy')).toBe('true');
      expect(add.querySelector('ui-progress-view')).not.toBeNull();

      const gone = render(
        visit({
          appointmentId: 'appointment-3',
          rowId: 'appointment-3#ivan',
          photos: PHOTOS,
          status: 'cancelled',
          statusLabel: 'Отказан',
          primaryVerb: null,
          overflowVerbs: [],
          resolution: {
            kind: 'cancelled',
            by: 'staff',
            whenLabel: '11:51',
            detail: null,
          },
        }),
      );
      expect(find(gone, 'staff-visit-photo-grid')).not.toBeNull();
      expect(find(gone, 'staff-visit-add-photo')).toBeNull();

      const draft = render(visit({ appointmentId: '', rowId: '', photos: [] }));
      expect(find(draft, 'staff-visit-photos')).toBeNull();
    });

    it('opens a picture as a VIEWER — full-bleed in its own shape, the facts as rows beneath it, the people with their faces — and «Изтрий» in the dock takes it down and comes back', () => {
      const host = render(visit({ photos: PHOTOS }));
      fixture.componentRef.setInput('uiBarbers', [
        {
          id: 'ivan',
          label: 'Иван Колев',
          tone: 1,
          avatarSrc: '/barbers/ivan.jpg',
        },
      ]);
      fixture.detectChanges();
      const removed: string[] = [];
      fixture.componentInstance.photoRemoved.subscribe((id) =>
        removed.push(id),
      );
      click(host, 'staff-visit-photo-p-1');
      expect(find(host, 'staff-visit-page')?.getAttribute('data-page')).toBe(
        'photo',
      );
      // No title: the header names the moment, as Photos does, and the
      // page's own heading is for assistive tech alone.
      expect(fixture.componentInstance.pageTitle()).toBe(
        when(PHOTOS[0]!.takenAtIso),
      );
      const heading = host.querySelector('#staff-visit-page-title');
      expect(heading?.textContent?.trim()).toBe(when(PHOTOS[0]!.takenAtIso));
      expect(heading?.hasAttribute('uivisuallyhidden')).toBe(true);
      // The picture, full-bleed, in its own shape — nothing drawn over it.
      const hero = find(host, 'staff-visit-photo-page');
      expect(hero?.classList.contains('staff-visit__photo-hero')).toBe(true);
      expect(
        hero?.querySelector('ui-async-image')?.getAttribute('style'),
      ).toContain('1600 / 1200');
      expect(hero?.querySelector('button, ui-avatar')).toBeNull();
      // The facts, as rows, by default (owner: "shown by default … user
      // rows"): the chair with the portrait and its legend, the client with
      // initials, then when — in the sheet's own person-row grammar.
      const info = find(host, 'staff-visit-photo-info');
      expect(info?.classList.contains('ui-list-group')).toBe(true);
      expect(info?.hasAttribute('inert')).toBe(false);
      const chairRow = find(host, 'staff-visit-photo-chair-row');
      expect(chairRow?.getAttribute('data-alignment')).toBe('leading');
      expect(
        chairRow
          ?.querySelector('[uileading] ui-avatar img')
          ?.getAttribute('src'),
      ).toBe('/barbers/ivan.jpg');
      expect(
        chairRow
          ?.querySelector('.staff-visit__swatch')
          ?.getAttribute('data-barber-tone'),
      ).toBe('1');
      expect(text(host, 'staff-visit-photo-chair')).toBe('Иван Колев');
      expect(chairRow?.textContent).toContain('Бръснар');
      const clientRow = find(host, 'staff-visit-photo-client-row');
      expect(
        clientRow
          ?.querySelector('[uileading] ui-avatar .ui-avatar__fallback')
          ?.textContent?.trim(),
      ).toBe('ГП');
      expect(clientRow?.querySelector('[uileading] ui-avatar img')).toBeNull();
      expect(text(host, 'staff-visit-photo-client')).toBe('Георги Петров');
      expect(clientRow?.textContent).toContain('Клиент');
      expect(text(host, 'staff-visit-photo-when')).toBe(
        when(PHOTOS[0]!.takenAtIso),
      );
      // The dock: no bill, no save — the one red act.
      expect(find(host, 'staff-visit-save')).toBeNull();
      expect(find(host, 'staff-visit-total')).toBeNull();
      const remove = find(host, 'staff-visit-photo-remove');
      expect(remove?.getAttribute('data-role')).toBe('destructive');
      expect(text(host, 'staff-visit-photo-remove')).toBe('Изтрий снимката');
      click(host, 'staff-visit-photo-remove');
      expect(removed).toEqual(['p-1']);
      expect(find(host, 'staff-visit-page')).toBeNull();
      // A picture that never said its shape is drawn 4:3; a chair the sheet
      // no longer knows and the photo never named has no row at all.
      click(host, 'staff-visit-photo-p-2');
      expect(
        find(host, 'staff-visit-photo-page')
          ?.querySelector('ui-async-image')
          ?.getAttribute('style'),
      ).toContain('4 / 3');
      expect(find(host, 'staff-visit-photo-chair-row')).toBeNull();
      expect(find(host, 'staff-visit-photo-client-row')).not.toBeNull();
      expect(text(host, 'staff-visit-photo-client')).toBe('Георги Петров');
    });

    it('hands every picked file up at once — a photo is not a draft — and leaves the draft clean', () => {
      const host = render(visit({ photos: [] }));
      const picked: string[] = [];
      fixture.componentInstance.photoPicked.subscribe((file) =>
        picked.push(file.name),
      );
      const input = find(host, 'staff-visit-photo-library') as HTMLInputElement;
      Object.defineProperty(input, 'files', {
        value: [
          new File(['a'], 'before.jpg', { type: 'image/jpeg' }),
          new File(['b'], 'after.png', { type: 'image/png' }),
        ],
        configurable: true,
      });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(picked).toEqual(['before.jpg', 'after.png']);
      expect(host.hasAttribute('data-dirty')).toBe(false);
      expect(find(host, 'staff-visit-save')).toBeNull();
    });

    it("takes the camera as a page — the DS viewfinder with the shutter in the dock — and offers the phone's picker where there is no camera", () => {
      const host = render(visit({ photos: [] }));
      fixture.componentRef.setInput('uiCamera', true);
      fixture.detectChanges();
      click(host, 'staff-visit-add-photo');
      pickDoor(host, 'staff-visit-photo-take');
      expect(find(host, 'staff-visit-page')?.getAttribute('data-page')).toBe(
        'camera',
      );
      expect(fixture.componentInstance.pageTitle()).toBe('Снимай');
      const camera = find(host, 'staff-visit-camera');
      expect(camera?.tagName).toBe('UI-CAMERA-CAPTURE');
      expect(camera?.querySelector('video')?.hasAttribute('playsinline')).toBe(
        true,
      );
      // This engine has no camera to ask: the viewfinder says so in the
      // sheet's words, and the dock offers the phone's picker in the
      // shutter's place — which pops the page and opens the picker.
      expect(camera?.getAttribute('data-state')).toBe('unsupported');
      expect(
        camera?.querySelector('[role="status"]')?.textContent?.trim(),
      ).toBe('Тук няма камера — качи снимка от телефона.');
      expect(find(host, 'staff-visit-shutter')).toBeNull();
      const library = find(
        host,
        'staff-visit-photo-library',
      ) as HTMLInputElement;
      const opened = vi.spyOn(library, 'click');
      click(host, 'staff-visit-camera-upload');
      expect(find(host, 'staff-visit-page')).toBeNull();
      expect(opened).toHaveBeenCalledTimes(1);
    });

    it("offers the shop's own pictures as a page — named, a tap assigns one and comes back — and says so on the photo's page", () => {
      const host = render(visit({ photos: [...PHOTOS, ADOPTED] }));
      fixture.componentRef.setInput('uiLibrary', LIBRARY);
      fixture.detectChanges();
      const adopted: string[] = [];
      fixture.componentInstance.libraryPicked.subscribe((image) =>
        adopted.push(image.id),
      );
      click(host, 'staff-visit-add-photo');
      pickDoor(host, 'staff-visit-photo-system');
      expect(find(host, 'staff-visit-page')?.getAttribute('data-page')).toBe(
        'library',
      );
      expect(fixture.componentInstance.pageTitle()).toBe('От галерията');
      // The shared showcase gallery — the barber's and the service's own
      // sheets' — just pictures, no names (owner: "exactly the same"), the
      // mosaic only: no strip, no toggle (owner: "only a grid").
      const gallery = find(host, 'staff-visit-library');
      expect(gallery?.tagName).toBe('CR-SHOWCASE-GALLERY');
      expect(gallery?.querySelector('ui-grid')).not.toBeNull();
      expect(gallery?.querySelector('ui-scroll-row')).toBeNull();
      expect(gallery?.querySelector('button.ui-button')).toBeNull();
      const tiles = [...(gallery?.querySelectorAll('figure') ?? [])];
      expect(tiles.length).toBe(2);
      expect(
        gallery?.querySelector('figcaption, .staff-visit__photo-caption'),
      ).toBeNull();
      expect(tiles.every((tile) => tile.textContent?.trim() === '')).toBe(true);
      const picks = [
        ...(gallery?.querySelectorAll<HTMLButtonElement>(
          'button.showcase-gallery__pick',
        ) ?? []),
      ];
      expect(picks.length).toBe(2);
      expect(picks.map((pick) => pick.getAttribute('aria-checked'))).toEqual([
        'false',
        'false',
      ]);
      // Nothing picked: the dock's ✓ is the way back. PICKING, as Photos
      // does: a check on the tile, the count at the dock's leading edge,
      // «Добави» for them all; a second tap unmarks.
      expect(find(host, 'staff-visit-page-done')).not.toBeNull();
      expect(find(host, 'staff-visit-library-count')).toBeNull();
      picks[1]?.click();
      fixture.detectChanges();
      expect(picks[1]?.getAttribute('aria-checked')).toBe('true');
      expect(
        picks[1]?.querySelector(
          '.showcase-gallery__check ui-icon[data-name="checklist.done"]',
        ),
      ).not.toBeNull();
      // …in the BILL's own dress: the caption in the footnote over the
      // figure in the headline, tabular — the dock's total, counted.
      const count = find(host, 'staff-visit-library-count');
      expect(count?.classList.contains('staff-visit__total')).toBe(true);
      const caption = count?.querySelector('[data-font="footnote"]');
      expect(caption?.textContent?.trim()).toBe('Избрани');
      expect(caption?.getAttribute('data-foreground-style')).toBe('secondary');
      const figure = find(host, 'staff-visit-library-count-figure');
      expect(figure?.getAttribute('data-font')).toBe('headline');
      expect(figure?.getAttribute('data-weight')).toBe('semibold');
      expect(figure?.classList.contains('staff-visit__figures')).toBe(true);
      expect(text(host, 'staff-visit-library-count-figure')).toBe('1');
      expect(find(host, 'staff-visit-page-done')).toBeNull();
      expect(text(host, 'staff-visit-library-add')).toBe('Добави');
      picks[0]?.click();
      fixture.detectChanges();
      expect(text(host, 'staff-visit-library-count-figure')).toBe('2');
      picks[1]?.click();
      fixture.detectChanges();
      expect(picks[1]?.getAttribute('aria-checked')).toBe('false');
      expect(text(host, 'staff-visit-library-count-figure')).toBe('1');
      picks[1]?.click();
      fixture.detectChanges();
      // «Добави»: every picked picture, in the catalogue's order, and back.
      click(host, 'staff-visit-library-add');
      expect(adopted).toEqual(['svc-cut:0', 'svc-fade:1']);
      expect(find(host, 'staff-visit-page')).toBeNull();
      // Opening the gallery again starts with nothing picked.
      click(host, 'staff-visit-add-photo');
      pickDoor(host, 'staff-visit-photo-system');
      expect(find(host, 'staff-visit-library-count')).toBeNull();
      expect(find(host, 'staff-visit-page-done')).not.toBeNull();
      fixture.componentInstance.pop();
      fixture.detectChanges();
      // A picture pointed at says which of the shop's it is, on its page.
      click(host, 'staff-visit-photo-p-3');
      expect(text(host, 'staff-visit-photo-source')).toBe('Модерна визия');
      fixture.componentInstance.pop();
      fixture.detectChanges();
      click(host, 'staff-visit-photo-p-1');
      expect(find(host, 'staff-visit-photo-source')).toBeNull();
      fixture.componentInstance.pop();
      fixture.detectChanges();
      // Nothing in the gallery yet: the page says so.
      fixture.componentRef.setInput('uiLibrary', []);
      fixture.detectChanges();
      click(host, 'staff-visit-add-photo');
      pickDoor(host, 'staff-visit-photo-system');
      expect(find(host, 'staff-visit-library')).toBeNull();
      expect(text(host, 'staff-visit-library-empty')).toBe(
        'Още няма снимки в галерията.',
      );
    });
  });

  describe('the discount row and its page', () => {
    const GRANTS = [
      {
        grantId: 'grant-birthday',
        couponId: 'coupon-birthday',
        label: 'Рожден ден',
        value: { kind: 'percent_off' as const, percent: 20 },
        exclusive: true,
      },
      {
        grantId: 'grant-loyal',
        couponId: 'coupon-loyal',
        label: 'Постоянен клиент',
        value: { kind: 'percent_off' as const, percent: 5 },
        exclusive: false,
      },
    ];

    /** The shop's live codes — what the «Промо код» kind offers as cards. */
    const PROMOS = [
      {
        code: 'FIRST10',
        couponId: 'coupon-first10',
        label: 'Първо посещение',
        value: { kind: 'percent_off' as const, percent: 10 },
        exclusive: false,
      },
      {
        code: 'BEARD5',
        couponId: 'coupon-beard5',
        label: 'Брада −5 €',
        value: { kind: 'fixed_amount' as const, amountMinorUnits: 500 },
        exclusive: false,
      },
      {
        code: 'ALONE20',
        couponId: 'coupon-alone20',
        label: 'Само за нови',
        value: { kind: 'percent_off' as const, percent: 20 },
        exclusive: true,
      },
    ];

    const renderWith = (
      vm: VisitEditorVm = visit(),
      inputs: Record<string, unknown> = {},
    ) => {
      for (const [key, value] of Object.entries(inputs)) {
        fixture.componentRef.setInput(key, value);
      }
      return render(vm);
    };

    /** The row pushes the PAGE — the shell's own page, never a menu or a sheet. */
    const openPage = (host: HTMLElement) =>
      click(host, 'staff-visit-discount-row');
    const page = (host: HTMLElement) => find(host, 'staff-visit-page');
    const onPage = (host: HTMLElement) =>
      page(host)?.getAttribute('data-page') === 'discount';
    /** The row's one-line reading of the bill. */
    const rowValue = (host: HTMLElement) =>
      text(host, 'staff-visit-discount-row-value');

    /** The «Вид» row's value — the pop-up's trigger, or the one kind stated. */
    const kindValue = (host: HTMLElement) =>
      text(host, 'staff-visit-discount-kind-value');

    /** The kinds the «Вид» pop-up offers, in order; closed again on the one in force. */
    const kindsOffered = (host: HTMLElement, current: string) => {
      click(host, 'staff-visit-discount-kind');
      const ids = [
        ...host.querySelectorAll(
          'ui-menu[data-open] button[data-testid^="staff-visit-discount-kind-"]',
        ),
      ].map((node) => node.getAttribute('data-testid'));
      pickOpen(host, `staff-visit-discount-kind-${current}`);
      return ids;
    };

    const pickKind = (host: HTMLElement, kind: string) => {
      click(host, 'staff-visit-discount-kind');
      pickOpen(host, `staff-visit-discount-kind-${kind}`);
    };

    /** The OFFERS on the page, in order — every ticket in a frame, whatever its state. */
    const offers = (host: HTMLElement) =>
      [
        ...host.querySelectorAll(
          '[data-testid="staff-visit-page"] [data-testid$="-list"] .ui-coupon-card',
        ),
      ].map((node) => node.getAttribute('data-testid'));

    /** The lines on the bill as the tickets the «Приложени» row unfolds — the evaluator's order, the vouchers after; in the tree folded or not. */
    const applied = (host: HTMLElement) =>
      [
        ...(find(host, 'staff-visit-discount-applied')?.querySelectorAll(
          ':scope > .ui-coupon-card',
        ) ?? []),
      ].map((node) => node.getAttribute('data-testid'));

    /** A ticket's state: on offer, applied, or blocked and muted. */
    const stateOf = (host: HTMLElement, testId: string) => {
      const card = find(host, testId);
      if (!card) return null;
      if (card.hasAttribute('data-applied')) return 'applied';
      if (card.hasAttribute('data-unavailable')) return 'blocked';
      return 'offer';
    };

    /** The figure on a ticket (the formatter's narrow no-break space read as one). */
    const valueOf = (host: HTMLElement, testId: string) =>
      find(host, testId)
        ?.querySelector('.ui-coupon-card__value')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();

    /** The chip on a ticket. */
    const detailOf = (host: HTMLElement, testId: string) =>
      find(host, testId)
        ?.querySelector('.ui-coupon-card__detail')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();

    const codeField = (host: HTMLElement) =>
      find(host, 'staff-visit-discount-code') as HTMLInputElement;

    /** Types into the code field — the dock's promise reads it; nothing is asked yet. */
    const typeCode = (host: HTMLElement, value: string) => {
      const field = codeField(host);
      field.value = value;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    /** «Приложи …» — the one act, in the DOCK. */
    const apply = (host: HTMLElement) =>
      click(host, 'staff-visit-discount-apply');

    /** Types a code and applies it: now the owner is asked. */
    const askCode = (host: HTMLElement, value: string) => {
      typeCode(host, value);
      apply(host);
    };

    const applyButton = (host: HTMLElement) =>
      find(host, 'staff-visit-discount-apply') as HTMLButtonElement | null;

    const typeFigure = (field: HTMLInputElement, value: string) => {
      field.value = value;
      field.dispatchEvent(new Event('input'));
      field.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };

    const slide = (host: HTMLElement, testId: string, value: string) => {
      const slider = find(host, testId) as HTMLInputElement;
      slider.value = value;
      slider.dispatchEvent(new Event('input'));
      slider.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };

    const answer = (result: unknown) => {
      fixture.componentRef.setInput('uiPromoCode', result);
      fixture.detectChanges();
    };

    const promo = (
      code: string,
      label: string,
      value: unknown,
      exclusive = false,
    ) => ({
      code,
      promo: { label, value, exclusive },
      voucher: null,
      refusal: null,
    });

    it("shows the value row that whispers the client's coupon, pushes the page, honours the coupon in place, and lays the ticket at the top of the page", () => {
      const host = renderWith(visit(), { uiGrants: GRANTS });
      const row = find(host, 'staff-visit-discount-row');
      expect(row?.tagName).toBe('BUTTON');
      expect(row?.closest('[data-testid="staff-visit-money"]')).not.toBeNull();
      // A VALUE row (owner, 2026-09-17: "Discount — None ›"): «Няма» in the
      // secondary ink, the › that promises the page, no plus; the coupon
      // the client holds whispered under the name in the promo ink —
      // recognition, not recall.
      expect(rowValue(host)).toBe('Няма');
      expect(
        find(host, 'staff-visit-discount-row-value')?.getAttribute(
          'data-foreground-style',
        ),
      ).toBe('secondary');
      expect(
        row?.querySelector('ui-icon[data-name="nav.disclosure"]'),
      ).not.toBeNull();
      expect(row?.querySelector('[uileading]')).toBeNull();
      expect(row?.getAttribute('aria-label')).toBe(
        'Отстъпка: Няма, Има купон: Рожден ден',
      );
      expect(text(host, 'staff-visit-discount-row-note')).toBe(
        'Има купон: Рожден ден',
      );
      expect(
        find(host, 'staff-visit-discount-row-note')?.getAttribute(
          'data-foreground-style',
        ),
      ).toBe('promo');
      expect(
        host.querySelector('[data-testid="staff-visit-money"] .ui-coupon-card'),
      ).toBeNull();
      expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');
      expect(host.hasAttribute('data-dirty')).toBe(false);

      openPage(host);
      // A PAGE (owner, 2026-09-17: "adding a discount → push sheet / page"):
      // the shell's ‹ and its own name in the bar, nothing on the bill yet,
      // the dock's ✓ beside the bill it reads. Never a sheet, never a menu.
      expect(onPage(host)).toBe(true);
      expect(fixture.componentInstance.depth()).toBe(1);
      expect(fixture.componentInstance.pageTitle()).toBe('Отстъпка');
      expect(
        host.querySelector('#staff-visit-page-title')?.textContent?.trim(),
      ).toBe('Отстъпка');
      expect(host.querySelector('ui-modal-sheet')).toBeNull();
      expect(applyButton(host)).toBeNull();
      expect(find(host, 'staff-visit-page-done')).not.toBeNull();
      expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');
      // «Вид», in its own group under the «Приложени» group: no codes to
      // offer and no money role leave one kind, the voucher or coupon —
      // stated, not offered (a pop-up needs options).
      const kindGroup = find(host, 'staff-visit-discount-add-group');
      expect(
        kindGroup?.closest('[data-testid="staff-visit-page"]'),
      ).not.toBeNull();
      expect(kindValue(host)).toBe('Ваучер / Купон');
      expect(find(host, 'staff-visit-discount-kind')).toBeNull();
      // The field a stranger's voucher goes in by, and the client's own
      // coupons as tickets in their frame beneath it.
      expect(
        codeField(host).closest('[data-testid="staff-visit-page"]'),
      ).not.toBeNull();
      expect(find(host, 'staff-visit-discount-scan')).toBeNull();
      expect(offers(host)).toEqual([
        'staff-visit-discount-grant-grant-birthday',
        'staff-visit-discount-grant-grant-loyal',
      ]);
      expect(
        find(host, 'staff-visit-discount-grant-grant-birthday')?.closest(
          '[data-testid="staff-visit-discount-grant-list"]',
        ),
      ).not.toBeNull();
      expect(valueOf(host, 'staff-visit-discount-grant-grant-birthday')).toBe(
        '−20%',
      );
      expect(detailOf(host, 'staff-visit-discount-grant-grant-birthday')).toBe(
        'само този',
      );
      expect(stateOf(host, 'staff-visit-discount-grant-grant-birthday')).toBe(
        'offer',
      );
      expect(valueOf(host, 'staff-visit-discount-grant-grant-loyal')).toBe(
        '−5%',
      );
      expect(detailOf(host, 'staff-visit-discount-grant-grant-loyal')).toBe(
        'комбинира се',
      );

      // «Използвай» applies IN PLACE: the ticket is stamped where it stands,
      // «Премахни» where the call stood, the exclusive one beside it
      // blocked — and the line lands as its ticket in the fold under
      // «Приложени», the row reading it; nothing above «Вид» moves (owner,
      // 2026-09-17). The page stays; the dock's price moves (20% of 28,00 €
      // is 5,60 €), the old one struck.
      click(host, 'staff-visit-discount-grant-grant-birthday');
      expect(onPage(host)).toBe(true);
      expect(offers(host)).toEqual([
        'staff-visit-discount-grant-grant-birthday',
        'staff-visit-discount-grant-grant-loyal',
      ]);
      expect(stateOf(host, 'staff-visit-discount-grant-grant-birthday')).toBe(
        'applied',
      );
      expect(
        find(
          host,
          'staff-visit-discount-grant-grant-birthday-remove',
        )?.textContent?.trim(),
      ).toBe('Премахни');
      expect(stateOf(host, 'staff-visit-discount-grant-grant-loyal')).toBe(
        'blocked',
      );
      const loyal = find(
        host,
        'staff-visit-discount-grant-grant-loyal',
      ) as HTMLButtonElement;
      expect(loyal.disabled).toBe(true);
      expect(
        loyal.querySelector(
          '.ui-coupon-card__badge ui-icon[data-name="booking.blocked"]',
        ),
      ).not.toBeNull();
      expect(
        loyal.querySelector('.ui-coupon-card__action')?.textContent?.trim(),
      ).toBe('Не се комбинира');
      expect(applied(host)).toEqual([
        'staff-visit-discount-grant:grant-birthday',
      ]);
      expect(
        find(host, 'staff-visit-discount-grant:grant-birthday')?.closest(
          '[data-testid="staff-visit-discount-lines"]',
        ),
      ).not.toBeNull();
      expect(text(host, 'staff-visit-discount-lines-value')).toBe(
        'Рожден ден (5,60 €)',
      );
      expect(
        find(
          host,
          'staff-visit-discount-add-group',
        )?.previousElementSibling?.getAttribute('data-testid'),
      ).toBe('staff-visit-discount-lines-group');
      expect(text(host, 'staff-visit-total-was')).toBe('28,00 €');
      expect(text(host, 'staff-visit-total-figure')).toBe('22,40 €');
      expect(host.hasAttribute('data-dirty')).toBe(true);

      // Back on the ladder the row reads the ONE line — its name, what it
      // took off — in the promo ink, the whisper gone; the line travels
      // with «Запази».
      back();
      expect(page(host)).toBeNull();
      expect(rowValue(host)).toBe('Рожден ден (5,60 €)');
      expect(
        find(host, 'staff-visit-discount-row-value')?.getAttribute(
          'data-foreground-style',
        ),
      ).toBe('promo');
      expect(
        find(host, 'staff-visit-discount-row')
          ?.getAttribute('aria-label')
          ?.replace(/[\u202f\u00a0]/g, ' '),
      ).toBe('Отстъпка: Рожден ден (5,60 €)');
      expect(find(host, 'staff-visit-discount-row-note')).toBeNull();
      expect(text(host, 'staff-visit-total-figure')).toBe('22,40 €');
      const commits: unknown[] = [];
      fixture.componentInstance.committed.subscribe((c) => commits.push(c));
      click(host, 'staff-visit-save');
      expect(commits[0]).toMatchObject({
        kind: 'save',
        discounts: [
          {
            source: 'grant',
            grantId: 'grant-birthday',
            label: 'Рожден ден',
            value: { kind: 'percent_off', percent: 20 },
            code: null,
            exclusive: true,
          },
        ],
        vouchers: [],
        tipMinorUnits: null,
      });

      // «Премахни» on the card takes it off — the offer is on offer again
      // and its neighbour usable; the row reads «Няма» and whispers again.
      openPage(host);
      click(host, 'staff-visit-discount-grant-grant-birthday-remove');
      expect(stateOf(host, 'staff-visit-discount-grant-grant-birthday')).toBe(
        'offer',
      );
      expect(stateOf(host, 'staff-visit-discount-grant-grant-loyal')).toBe(
        'offer',
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');
      expect(host.hasAttribute('data-dirty')).toBe(false);
      click(host, 'staff-visit-discount-grant-grant-loyal');
      expect(stateOf(host, 'staff-visit-discount-grant-grant-loyal')).toBe(
        'applied',
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('26,60 €');
      click(host, 'staff-visit-discount-grant-grant-loyal-remove');
      expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');
      back();
      expect(rowValue(host)).toBe('Няма');
      expect(text(host, 'staff-visit-discount-row-note')).toBe(
        'Има купон: Рожден ден',
      );
    });

    it("offers the shop's live codes as tickets under «Промо код» — in the store's order, in place, the rule as the figure — and stacks the stackable", () => {
      const host = renderWith(visit(), { uiPromos: PROMOS });
      openPage(host);
      // The kind in force: the shop's codes, the first on offer where the
      // client holds nothing of their own; the pop-up offers the voucher too.
      expect(kindValue(host)).toBe('Промо код');
      expect(kindsOffered(host, 'promo')).toEqual([
        'staff-visit-discount-kind-promo',
        'staff-visit-discount-kind-coupon',
      ]);
      // NO field for the promo kind — every code is listed — and no search.
      expect(find(host, 'staff-visit-discount-query')).toBeNull();
      expect(find(host, 'staff-visit-discount-code')).toBeNull();
      // The codes as TICKETS, stacked in the DS scroll column, in the
      // store's order, each the offer's RULE — never a bill preview — and
      // whether it stacks.
      const frame = find(host, 'staff-visit-discount-promo-list');
      expect(frame?.tagName.toLowerCase()).toBe('ui-scroll-column');
      expect(offers(host)).toEqual([
        'staff-visit-discount-promo-FIRST10',
        'staff-visit-discount-promo-BEARD5',
        'staff-visit-discount-promo-ALONE20',
      ]);
      const first = find(host, 'staff-visit-discount-promo-FIRST10');
      expect(first?.tagName).toBe('BUTTON');
      expect(first?.getAttribute('aria-label')).toBe(
        'Първо посещение, FIRST10, −10%',
      );
      expect(text(host, 'staff-visit-discount-promo-FIRST10-code')).toBe(
        'FIRST10',
      );
      expect(valueOf(host, 'staff-visit-discount-promo-FIRST10')).toBe('−10%');
      expect(detailOf(host, 'staff-visit-discount-promo-FIRST10')).toBe(
        'комбинира се',
      );
      expect(valueOf(host, 'staff-visit-discount-promo-BEARD5')).toBe(
        '−5,00 €',
      );
      expect(valueOf(host, 'staff-visit-discount-promo-ALONE20')).toBe('−20%');
      expect(detailOf(host, 'staff-visit-discount-promo-ALONE20')).toBe(
        'само този',
      );

      // ONE TAP applies a code in place: the ticket is stamped where it
      // stands, the exclusive one beside it blocked, the page stays — the
      // line's ticket in the fold under «Приложени», the row reading it.
      click(host, 'staff-visit-discount-promo-FIRST10');
      expect(onPage(host)).toBe(true);
      expect(stateOf(host, 'staff-visit-discount-promo-FIRST10')).toBe(
        'applied',
      );
      expect(stateOf(host, 'staff-visit-discount-promo-BEARD5')).toBe('offer');
      expect(stateOf(host, 'staff-visit-discount-promo-ALONE20')).toBe(
        'blocked',
      );
      expect(applied(host)).toEqual(['staff-visit-discount-code:FIRST10']);
      expect(text(host, 'staff-visit-discount-lines-value')).toBe(
        'FIRST10 (2,80 €)',
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('25,20 €');
      // A stackable second is one more tap — the fixed sum first, then the
      // percent of what is left: 28,00 − 5,00 = 23,00, then 2,30 — the
      // evaluator's order, read off the price (10% first would be 20,20).
      click(host, 'staff-visit-discount-promo-BEARD5');
      expect(stateOf(host, 'staff-visit-discount-promo-BEARD5')).toBe(
        'applied',
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('20,70 €');
      // The fold holds both, whatever the kind — the fixed sum first, its
      // rule its amount, the percent with what it took off of what was
      // left; the row counts them.
      expect(applied(host)).toEqual([
        'staff-visit-discount-code:BEARD5',
        'staff-visit-discount-code:FIRST10',
      ]);
      expect(valueOf(host, 'staff-visit-discount-code:BEARD5')).toBe('−5,00 €');
      expect(text(host, 'staff-visit-discount-code:BEARD5-code')).toBe(
        'BEARD5',
      );
      expect(find(host, 'staff-visit-discount-code:BEARD5-detail')).toBeNull();
      expect(detailOf(host, 'staff-visit-discount-code:FIRST10')).toBe(
        '−2,30 €',
      );
      expect(text(host, 'staff-visit-discount-lines-value')).toBe(
        '2 отстъпки (7,30 €)',
      );
      // The row counts them, and what they took off together.
      back();
      expect(rowValue(host)).toBe('2 приложени (7,30 €)');
      const commits: unknown[] = [];
      fixture.componentInstance.committed.subscribe((c) => commits.push(c));
      click(host, 'staff-visit-save');
      expect(commits[0]).toMatchObject({ kind: 'save' });
      expect(
        (
          commits[0] as { discounts: readonly { code: string | null }[] }
        ).discounts
          .map((line) => line.code)
          .sort(),
      ).toEqual(['BEARD5', 'FIRST10']);
    });

    it("stacks what may stack, in the evaluator's order, and blocks what cannot sit beside what is on the bill", () => {
      const host = renderWith(visit(), { uiGrants: GRANTS, uiPromos: PROMOS });
      openPage(host);
      click(host, 'staff-visit-discount-grant-grant-loyal');
      pickKind(host, 'promo');
      click(host, 'staff-visit-discount-promo-BEARD5');
      // The fixed sum comes off first, then 5% of what is left: 28,00 −
      // 5,00 = 23,00, then 1,15 — the evaluator's order, in the price.
      expect(stateOf(host, 'staff-visit-discount-promo-BEARD5')).toBe(
        'applied',
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('21,85 €');
      // An exclusive coupon must be alone: while anything stands it is
      // BLOCKED, muted and inert — never silently clearing the others.
      expect(stateOf(host, 'staff-visit-discount-promo-ALONE20')).toBe(
        'blocked',
      );
      pickKind(host, 'coupon');
      expect(stateOf(host, 'staff-visit-discount-grant-grant-birthday')).toBe(
        'blocked',
      );
      click(host, 'staff-visit-discount-grant-grant-birthday');
      expect(stateOf(host, 'staff-visit-discount-grant-grant-birthday')).toBe(
        'blocked',
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('21,85 €');
      // Take the others off — «Премахни» on each card, where it stands —
      // and the exclusive one is on offer…
      click(host, 'staff-visit-discount-grant-grant-loyal-remove');
      pickKind(host, 'promo');
      click(host, 'staff-visit-discount-promo-BEARD5-remove');
      pickKind(host, 'coupon');
      expect(stateOf(host, 'staff-visit-discount-grant-grant-birthday')).toBe(
        'offer',
      );
      // …applied, it blocks everything else.
      click(host, 'staff-visit-discount-grant-grant-birthday');
      expect(stateOf(host, 'staff-visit-discount-grant-grant-birthday')).toBe(
        'applied',
      );
      expect(stateOf(host, 'staff-visit-discount-grant-grant-loyal')).toBe(
        'blocked',
      );
      pickKind(host, 'promo');
      expect(stateOf(host, 'staff-visit-discount-promo-FIRST10')).toBe(
        'blocked',
      );
      expect(stateOf(host, 'staff-visit-discount-promo-BEARD5')).toBe(
        'blocked',
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('22,40 €');
      back();
      expect(rowValue(host)).toBe('Рожден ден (5,60 €)');
    });

    it('offers the kinds on a pop-up in the «Вид» row — by role and by what is at hand — each bringing its own control in place, and forgets a half-typed entry with the kind', () => {
      const host = renderWith(visit(), {
        uiPromos: PROMOS,
        uiMayDiscount: true,
      });
      openPage(host);
      // «Вид»: the label leads, the VALUE is the trigger — plain, the
      // root's own duration grammar — on the page's own group.
      const trigger = find(host, 'staff-visit-discount-kind');
      expect(trigger?.tagName).toBe('BUTTON');
      expect(trigger?.closest('li')?.textContent).toContain('Вид');
      expect(
        trigger?.closest('[data-testid="staff-visit-page"]'),
      ).not.toBeNull();
      expect(trigger?.classList.contains('staff-visit__row-title')).toBe(true);
      expect(
        trigger?.querySelector('ui-icon[data-name="field.popUp"]'),
      ).not.toBeNull();
      expect(trigger?.getAttribute('aria-label')).toBe('Вид: Промо код');
      expect(kindsOffered(host, 'promo')).toEqual([
        'staff-visit-discount-kind-promo',
        'staff-visit-discount-kind-coupon',
        'staff-visit-discount-kind-percent',
        'staff-visit-discount-kind-amount',
      ]);
      // Each kind brings its own control, in place, and nothing else's.
      pickKind(host, 'coupon');
      expect(kindValue(host)).toBe('Ваучер / Купон');
      expect(trigger?.getAttribute('aria-label')).toBe('Вид: Ваучер / Купон');
      expect(find(host, 'staff-visit-discount-query')).toBeNull();
      expect(offers(host)).toEqual([]);
      typeCode(host, 'gift');
      expect(text(host, 'staff-visit-discount-apply')).toBe('Приложи GIFT');
      pickKind(host, 'percent');
      expect(find(host, 'staff-visit-discount-code')).toBeNull();
      expect(find(host, 'staff-visit-discount-percent-slider')).not.toBeNull();
      // The half-typed code did not follow; the dock is the ✓ again.
      expect(applyButton(host)).toBeNull();
      expect(find(host, 'staff-visit-page-done')).not.toBeNull();
      pickKind(host, 'coupon');
      expect(codeField(host).value).toBe('');
      // Back at the root and in again, the default stands: the shop's codes.
      back();
      openPage(host);
      expect(kindValue(host)).toBe('Промо код');
    });

    it('takes a typed code under «Ваучер / Купон»: «Приложи» asks from the dock, the verdict lands under the field, and a hit becomes a ticket at the top of the page', () => {
      const host = renderWith();
      const asked: string[] = [];
      fixture.componentInstance.promoCodeEntered.subscribe((c) =>
        asked.push(c),
      );
      // No coupon held, no codes given: the row whispers nothing, and the
      // page has the one kind, its field there at once.
      expect(find(host, 'staff-visit-discount-row-note')).toBeNull();
      openPage(host);
      expect(kindValue(host)).toBe('Ваучер / Купон');
      const field = codeField(host);
      expect(field.getAttribute('placeholder')).toBe('напр. GIFT2025');
      // The DS code field in the form field's dress, on the page under the
      // kind that names it — no row, no label, no hint.
      const codeHost = field.closest('ui-code-field');
      expect(codeHost?.getAttribute('data-appearance')).toBe('bordered');
      expect(codeHost?.getAttribute('data-control-size')).toBe('large');
      expect(field.closest('li')).toBeNull();
      expect(
        find(host, 'staff-visit-discount-code-block')?.querySelector('label'),
      ).toBeNull();
      // Nothing typed: the dock keeps its ✓ and nothing is asked.
      expect(applyButton(host)).toBeNull();
      expect(find(host, 'staff-visit-page-done')).not.toBeNull();
      // Typed: the promise reads the code, normalised, IN THE DOCK — the
      // main sheet's toolbar (owner, 2026-09-17); still nothing asked.
      typeCode(host, ' nope1234 ');
      expect(asked).toEqual([]);
      expect(text(host, 'staff-visit-discount-apply')).toBe('Приложи NOPE1234');
      expect(
        find(host, 'staff-visit-discount-apply')?.closest('.staff-visit__dock'),
      ).not.toBeNull();
      expect(find(host, 'staff-visit-page-done')).toBeNull();
      // «Приложи» asks, and waits for the answer — and says so.
      apply(host);
      expect(asked).toEqual(['NOPE1234']);
      expect(text(host, 'staff-visit-discount-code-note')).toBe('Проверявам…');
      expect(text(host, 'staff-visit-discount-apply')).toBe('Проверявам…');
      // …and the dock's button turns its ring while it waits (owner,
      // 2026-09-17: "add a spinner so you instantly know what is happening").
      expect(applyButton(host)?.getAttribute('data-state')).toBe('loading');
      expect(applyButton(host)?.getAttribute('aria-busy')).toBe('true');
      expect(
        applyButton(host)?.querySelector(
          '.ui-button__progress ui-progress-view',
        ),
      ).not.toBeNull();
      expect(applyButton(host)?.disabled).toBe(true);
      // A stale answer, to another code, changes nothing…
      answer({ code: 'OTHER', promo: null, voucher: null, refusal: null });
      expect(text(host, 'staff-visit-discount-code-note')).toBe('Проверявам…');
      // …and a refusal keeps the code and the ring, says why, and offers to
      // ask again.
      answer({ code: 'NOPE1234', promo: null, voucher: null, refusal: null });
      expect(text(host, 'staff-visit-discount-code-note')).toBe(
        'Няма такъв код.',
      );
      expect(
        find(host, 'staff-visit-discount-code-note')?.getAttribute('role'),
      ).toBe('alert');
      expect(codeField(host).getAttribute('aria-invalid')).toBe('true');
      expect(codeField(host).value).toBe('NOPE1234');
      expect(text(host, 'staff-visit-discount-apply')).toBe('Приложи NOPE1234');
      expect(applyButton(host)?.disabled).toBe(false);

      // A hit: the ticket lands in the fold under «Приложени» and the row
      // reads it, the field empties for the next, the page STAYS (owner,
      // 2026-09-17: "applied discounts should live in the push sheet"),
      // the dock is the ✓ again.
      askCode(host, 'first10');
      answer(
        promo('FIRST10', 'Първо посещение', {
          kind: 'percent_off',
          percent: 10,
        }),
      );
      expect(onPage(host)).toBe(true);
      expect(applied(host)).toEqual(['staff-visit-discount-code:FIRST10']);
      expect(text(host, 'staff-visit-discount-lines-value')).toBe(
        'FIRST10 (2,80 €)',
      );
      expect(text(host, 'staff-visit-discount-code:FIRST10-code')).toBe(
        'FIRST10',
      );
      expect(valueOf(host, 'staff-visit-discount-code:FIRST10')).toBe('−10%');
      expect(detailOf(host, 'staff-visit-discount-code:FIRST10')).toBe(
        '−2,80 €',
      );
      expect(codeField(host).value).toBe('');
      expect(find(host, 'staff-visit-discount-code-note')).toBeNull();
      expect(applyButton(host)).toBeNull();
      expect(text(host, 'staff-visit-total-figure')).toBe('25,20 €');
      // A code already on the bill is not asked about again.
      const before = asked.length;
      askCode(host, 'FIRST10');
      expect(asked.length).toBe(before);
      expect(text(host, 'staff-visit-discount-code-note')).toBe(
        'Вече е добавен.',
      );
      // Back on the ladder the row reads the code and what it took off;
      // in again, nothing is being said or typed.
      back();
      expect(rowValue(host)).toBe('FIRST10 (2,80 €)');
      openPage(host);
      expect(codeField(host).value).toBe('');
      expect(find(host, 'staff-visit-discount-code-note')).toBeNull();
    });

    it('takes a voucher through the field, covers what the discounts leave, and says what it has left — a ticket on the page, a line on the row', () => {
      const host = renderWith();
      openPage(host);
      askCode(host, 'first10');
      answer(
        promo('FIRST10', 'Първо посещение', {
          kind: 'percent_off',
          percent: 10,
        }),
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('25,20 €');

      askCode(host, 'gift2025');
      answer({
        code: 'GIFT2025',
        promo: null,
        voucher: {
          voucherId: 'v1',
          code: 'GIFT2025',
          availableMinorUnits: 1000,
        },
        refusal: null,
      });
      expect(onPage(host)).toBe(true);
      expect(applied(host)).toEqual([
        'staff-visit-discount-code:FIRST10',
        'staff-visit-voucher-v1',
      ]);
      const line = find(host, 'staff-visit-voucher-v1');
      expect(line?.tagName).toBe('ARTICLE');
      expect(line?.textContent).toContain('Ваучер');
      // A voucher's ticket wears the gift, its code beside what it covers,
      // and what it still holds in the chip.
      expect(
        line?.querySelector(
          '.ui-coupon-card__glyph ui-icon[data-name="promo.voucher"]',
        ),
      ).not.toBeNull();
      expect(stateOf(host, 'staff-visit-voucher-v1')).toBe('applied');
      expect(text(host, 'staff-visit-voucher-v1-code')).toBe('GIFT2025');
      expect(valueOf(host, 'staff-visit-voucher-v1')).toBe('−10,00 €');
      expect(detailOf(host, 'staff-visit-voucher-v1')).toBe('остават 0,00 €');
      expect(
        line?.getAttribute('aria-label')?.replace(/[\u202f\u00a0]/g, ' '),
      ).toBe('Ваучер, GIFT2025, −10,00 €, остават 0,00 €');
      expect(text(host, 'staff-visit-remove-voucher-v1')).toBe('Премахни');
      // The voucher PAYS: the price stays 25,20 €, the counter takes 15,20 €.
      expect(text(host, 'staff-visit-total-figure')).toBe('15,20 €');
      // The field emptied with the hit, ready for the next.
      expect(codeField(host).value).toBe('');

      // A second voucher covers only what is left, and says so.
      askCode(host, 'GIFT99');
      answer({
        code: 'GIFT99',
        promo: null,
        voucher: { voucherId: 'v2', code: 'GIFT99', availableMinorUnits: 5000 },
        refusal: null,
      });
      expect(valueOf(host, 'staff-visit-voucher-v2')).toBe('−15,20 €');
      expect(text(host, 'staff-visit-voucher-v2-code')).toBe('GIFT99');
      expect(detailOf(host, 'staff-visit-voucher-v2')).toBe('остават 34,80 €');
      expect(text(host, 'staff-visit-total-figure')).toBe('0,00 €');

      // With the bill paid, a third has nothing to cover — refused, under
      // the field, the page staying to say so.
      askCode(host, 'GIFT5');
      answer({
        code: 'GIFT5',
        promo: null,
        voucher: { voucherId: 'v3', code: 'GIFT5', availableMinorUnits: 500 },
        refusal: null,
      });
      expect(text(host, 'staff-visit-discount-code-note')).toBe(
        'Няма какво да покрие.',
      );
      expect(find(host, 'staff-visit-voucher-v3')).toBeNull();
      expect(onPage(host)).toBe(true);

      // The row counts every line — the discount and the vouchers — and
      // what they took off together.
      back();
      expect(rowValue(host)).toBe('3 приложени (28,00 €)');
      const commits: unknown[] = [];
      fixture.componentInstance.committed.subscribe((c) => commits.push(c));
      click(host, 'staff-visit-save');
      expect(commits[0]).toMatchObject({
        kind: 'save',
        discounts: [{ source: 'code', code: 'FIRST10' }],
        vouchers: [
          { voucherId: 'v1', code: 'GIFT2025' },
          { voucherId: 'v2', code: 'GIFT99' },
        ],
      });

      // Taken off by the ticket's «Премахни», the money is no longer counted.
      openPage(host);
      click(host, 'staff-visit-remove-voucher-v1');
      expect(find(host, 'staff-visit-voucher-v1')).toBeNull();
      expect(valueOf(host, 'staff-visit-voucher-v2')).toBe('−25,20 €');
    });

    it('says why a voucher will not take — spent, expired, void', () => {
      const host = renderWith();
      openPage(host);
      const voucher = {
        voucherId: 'v',
        code: 'EMPTY001',
        availableMinorUnits: 0,
      };
      for (const [refusal, note] of [
        ['empty', 'Ваучерът е изчерпан.'],
        ['expired', 'Ваучерът е изтекъл.'],
        ['void', 'Ваучерът е анулиран.'],
      ] as const) {
        askCode(host, 'EMPTY001');
        answer({ code: 'EMPTY001', promo: null, voucher, refusal });
        expect(text(host, 'staff-visit-discount-code-note')).toBe(note);
        expect(find(host, 'staff-visit-voucher-v')).toBeNull();
        expect(onPage(host)).toBe(true);
      }
    });

    it("reads a voucher with the camera where the engine has one — the scanner in the page's place, and back with the code, asked at once", () => {
      // This engine has neither a detector nor a camera: no scan glyph, and
      // typing is the way (HIG: never offer a control that cannot work).
      const bare = renderWith();
      openPage(bare);
      expect(find(bare, 'staff-visit-discount-scan')).toBeNull();
      back();

      // Told the camera can read a code, the field gets its scan glyph.
      const host = renderWith(visit(), { uiScan: true });
      openPage(host);
      const asked: string[] = [];
      fixture.componentInstance.promoCodeEntered.subscribe((c) =>
        asked.push(c),
      );
      const scan = find(host, 'staff-visit-discount-scan');
      expect(scan?.tagName).toBe('BUTTON');
      expect(scan?.getAttribute('aria-label')).toBe('Сканирай');
      expect(
        scan?.querySelector('ui-icon[data-name="action.scan"]'),
      ).not.toBeNull();
      // The glyph lives INSIDE the field's frame, after the input.
      expect(
        scan
          ?.closest('ui-code-field')
          ?.querySelector('[data-testid="staff-visit-discount-code"]'),
      ).not.toBeNull();
      expect(scan?.closest('.ui-code-field__frame')).not.toBeNull();

      // The scanner takes the page's place — its own title, the shell's ‹,
      // the camera, and «Въведи на ръка» in the dock: nothing to confirm,
      // nothing to apply.
      click(host, 'staff-visit-discount-scan');
      expect(find(host, 'staff-visit-page')?.getAttribute('data-page')).toBe(
        'scan',
      );
      expect(fixture.componentInstance.pageTitle()).toBe('Сканирай код');
      expect(fixture.componentInstance.depth()).toBe(1);
      expect(find(host, 'staff-visit-scanner')).not.toBeNull();
      expect(text(host, 'staff-visit-scan-type')).toBe('Въведи на ръка');
      expect(find(host, 'staff-visit-page-done')).toBeNull();
      expect(applyButton(host)).toBeNull();
      // «Въведи на ръка» is the discount page again, its field, with
      // nothing lost or asked.
      click(host, 'staff-visit-scan-type');
      expect(onPage(host)).toBe(true);
      expect(kindValue(host)).toBe('Ваучер / Купон');
      expect(codeField(host).value).toBe('');
      expect(asked).toEqual([]);

      // The camera reads a code: back to the field with it, normalised, and
      // asked at once — the same road a typed code takes from here.
      click(host, 'staff-visit-discount-scan');
      const scanner = fixture.debugElement.query(By.directive(UiCodeScanner))
        .componentInstance as UiCodeScanner;
      scanner.uiDetected.emit(' gift2025 ');
      fixture.detectChanges();
      expect(onPage(host)).toBe(true);
      expect(codeField(host).value).toBe('GIFT2025');
      expect(asked).toEqual(['GIFT2025']);
      expect(text(host, 'staff-visit-discount-code-note')).toBe('Проверявам…');
      answer({
        code: 'GIFT2025',
        promo: null,
        voucher: {
          voucherId: 'v1',
          code: 'GIFT2025',
          availableMinorUnits: 1000,
        },
        refusal: null,
      });
      // The hit lands the ticket and stays on the page, as a typed hit does.
      expect(find(host, 'staff-visit-voucher-v1')).not.toBeNull();
      expect(onPage(host)).toBe(true);
      expect(codeField(host).value).toBe('');
      expect(text(host, 'staff-visit-total-figure')).toBe('18,00 €');
    });

    it('keeps the percent and the sum for whoever handles the money — each a figure written large over a ruler, snapped to the bill past it, kept from the dock', () => {
      const host = renderWith(visit(), { uiMayDiscount: true });
      openPage(host);
      expect(kindsOffered(host, 'coupon')).toEqual([
        'staff-visit-discount-kind-coupon',
        'staff-visit-discount-kind-percent',
        'staff-visit-discount-kind-amount',
      ]);
      const marksOf = (testId: string) =>
        [
          ...(find(host, testId)
            ?.closest('ui-slider')
            ?.querySelectorAll('.ui-slider__mark') ?? []),
        ].map((node) =>
          node.textContent?.trim().replace(/[\u202f\u00a0]/g, ' '),
        );

      // THE PERCENT: the figure on a muted «0» with «%» beside it and no
      // stepper, and the ruler — a native range in five-percent steps, its
      // ticks lit, the quarters named. Nothing drafted: the dock's ✓.
      pickKind(host, 'percent');
      const percent = find(
        host,
        'staff-visit-discount-percent',
      ) as HTMLInputElement;
      expect(percent.closest('ui-amount-field')).not.toBeNull();
      expect(percent.getAttribute('placeholder')).toBe('0');
      expect(percent.getAttribute('inputmode')).toBe('numeric');
      expect(percent.value).toBe('');
      expect(find(host, 'staff-visit-discount-percent-increase')).toBeNull();
      expect(find(host, 'staff-visit-discount-figure-note')).toBeNull();
      expect(find(host, 'staff-visit-total-was')).toBeNull();
      expect(text(host, 'staff-visit-total-figure')).toBe('28,00 €');
      const slider = find(
        host,
        'staff-visit-discount-percent-slider',
      ) as HTMLInputElement;
      expect(slider.type).toBe('range');
      expect(slider.min).toBe('0');
      expect(slider.max).toBe('100');
      expect(slider.step).toBe('5');
      expect(slider.value).toBe('0');
      expect(marksOf('staff-visit-discount-percent-slider')).toEqual([
        '0%',
        '25%',
        '50%',
        '75%',
        '100%',
      ]);
      expect(
        slider
          .closest('ui-slider')
          ?.querySelectorAll('.ui-slider__ticks .ui-slider__tick'),
      ).toHaveLength(42);
      expect(applyButton(host)).toBeNull();
      expect(find(host, 'staff-visit-page-done')).not.toBeNull();

      // A move of the thumb drafts: the figure follows it, and the dock's
      // price previews what it would do — struck, the new one beside it
      // (15% of 28,00 € is 4,20 €) — before anything is kept, and the
      // dock promises «Приложи −15%».
      slide(host, 'staff-visit-discount-percent-slider', '15');
      expect(percent.value).toBe('15');
      expect(text(host, 'staff-visit-total-was')).toBe('28,00 €');
      expect(find(host, 'staff-visit-total-was')?.tagName).toBe('S');
      expect(text(host, 'staff-visit-total-figure')).toBe('23,80 €');
      expect(
        slider.getAttribute('aria-valuetext')?.replace(/[\u202f\u00a0]/g, ' '),
      ).toBe('−15% · 23,80 €');
      expect(text(host, 'staff-visit-discount-apply')).toBe('Приложи −15%');
      expect(find(host, 'staff-visit-page-done')).toBeNull();
      // Return in the figure keeps it, as the dock's button would; the
      // engine's late `change` does not redraft what was just kept. The
      // line is a TICKET in the fold under «Приложени»: «Отстъпка» over
      // its rule, the percent's glyph, what it took off in the chip. The
      // page stays; the figure and the thumb hold the line.
      percent.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      percent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(onPage(host)).toBe(true);
      expect(applied(host)).toEqual(['staff-visit-discount-manual']);
      const manual = find(host, 'staff-visit-discount-manual');
      expect(manual?.tagName).toBe('ARTICLE');
      expect(manual?.textContent).toContain('Отстъпка');
      expect(valueOf(host, 'staff-visit-discount-manual')).toBe('−15%');
      expect(find(host, 'staff-visit-discount-manual-code')).toBeNull();
      expect(detailOf(host, 'staff-visit-discount-manual')).toBe('−4,20 €');
      expect(
        manual?.querySelector(
          '.ui-coupon-card__glyph ui-icon[data-name="promo.percent"]',
        ),
      ).not.toBeNull();
      expect(text(host, 'staff-visit-total-was')).toBe('28,00 €');
      expect(text(host, 'staff-visit-total-figure')).toBe('23,80 €');
      expect(applyButton(host)).toBeNull();
      expect(percent.value).toBe('15');
      expect(slider.value).toBe('15');

      // Typed past a hundred: snapped to a hundred AS IT IS TYPED — the
      // figure, the thumb, the promise and the price all read the whole
      // bill; nothing to refuse.
      typeFigure(percent, '140');
      expect(percent.value).toBe('100');
      expect(slider.value).toBe('100');
      expect(find(host, 'staff-visit-discount-figure-note')).toBeNull();
      expect(text(host, 'staff-visit-discount-apply')).toBe('Приложи −100%');
      expect(applyButton(host)?.disabled).toBe(false);
      expect(text(host, 'staff-visit-total-figure')).toBe('0,00 €');
      // The floor promises nothing; the applied line still stands, and the
      // price says so.
      slide(host, 'staff-visit-discount-percent-slider', '0');
      expect(percent.value).toBe('0');
      expect(applyButton(host)).toBeNull();
      expect(find(host, 'staff-visit-discount-manual')).not.toBeNull();
      expect(text(host, 'staff-visit-total-figure')).toBe('23,80 €');

      // THE SUM, the same instrument: «0,00 €», the ruler from nothing to
      // the bill in half-euro steps, its ends named.
      pickKind(host, 'amount');
      const amount = find(
        host,
        'staff-visit-discount-amount',
      ) as HTMLInputElement;
      expect(amount.closest('ui-amount-field')).not.toBeNull();
      expect(amount.getAttribute('placeholder')).toBe('0,00');
      expect(find(host, 'staff-visit-discount-amount-increase')).toBeNull();
      expect(
        amount
          .closest('ui-amount-field')
          ?.querySelector('.ui-amount-field__line .ui-amount-field__unit')
          ?.textContent?.trim(),
      ).toBe('€');
      const sum = find(
        host,
        'staff-visit-discount-amount-slider',
      ) as HTMLInputElement;
      expect(sum.max).toBe('2800');
      expect(sum.step).toBe('50');
      expect(marksOf('staff-visit-discount-amount-slider')).toEqual([
        '0,00 €',
        '28,00 €',
      ]);
      expect(applyButton(host)).toBeNull();
      slide(host, 'staff-visit-discount-amount-slider', '500');
      expect(amount.value).toBe('5,00');
      // The price previews the sum in the percent's place — one manual line.
      expect(text(host, 'staff-visit-total-was')).toBe('28,00 €');
      expect(text(host, 'staff-visit-total-figure')).toBe('23,00 €');
      expect(text(host, 'staff-visit-discount-apply')).toBe('Приложи −5,00 €');
      // Past the bill, typed: snapped to the bill as it is typed.
      typeFigure(amount, '40');
      expect(amount.value).toBe('28,00');
      expect(sum.value).toBe('2800');
      expect(text(host, 'staff-visit-discount-apply')).toBe('Приложи −28,00 €');
      expect(text(host, 'staff-visit-total-figure')).toBe('0,00 €');
      typeFigure(amount, '5');
      expect(text(host, 'staff-visit-discount-apply')).toBe('Приложи −5,00 €');
      apply(host);
      // One manual line, corrected rather than piled on — a sum's ticket
      // wears the price tag and no chip (its amount IS the rule); the page
      // stays, the field and the thumb hold the kept figure.
      expect(onPage(host)).toBe(true);
      expect(applied(host)).toEqual(['staff-visit-discount-manual']);
      expect(valueOf(host, 'staff-visit-discount-manual')).toBe('−5,00 €');
      expect(find(host, 'staff-visit-discount-manual-detail')).toBeNull();
      expect(text(host, 'staff-visit-total-was')).toBe('28,00 €');
      expect(text(host, 'staff-visit-total-figure')).toBe('23,00 €');
      expect(
        find(host, 'staff-visit-discount-manual')?.querySelector(
          '.ui-coupon-card__glyph ui-icon[data-name="promo.sum"]',
        ),
      ).not.toBeNull();
      expect(amount.value).toBe('5,00');
      expect(sum.value).toBe('500');

      // A percent REPLACES the sum; the row names the line by its rule.
      pickKind(host, 'percent');
      slide(host, 'staff-visit-discount-percent-slider', '10');
      apply(host);
      expect(valueOf(host, 'staff-visit-discount-manual')).toBe('−10%');
      expect(detailOf(host, 'staff-visit-discount-manual')).toBe('−2,80 €');
      back();
      expect(rowValue(host)).toBe('−10% (2,80 €)');
      expect(text(host, 'staff-visit-total-was')).toBe('28,00 €');
      expect(text(host, 'staff-visit-total-figure')).toBe('25,20 €');
      const commits: unknown[] = [];
      fixture.componentInstance.committed.subscribe((c) => commits.push(c));
      click(host, 'staff-visit-save');
      expect(commits[0]).toMatchObject({
        kind: 'save',
        discounts: [
          {
            source: 'manual',
            value: { kind: 'percent_off', percent: 10 },
            grantId: null,
            code: null,
          },
        ],
      });
    });

    it('reads saved lines back — on the row as one line, on the page as tickets under «Приложени» — and withholds the money from a draft and a visit that is gone', () => {
      const saved = renderWith(
        visit({
          discounts: [
            {
              source: 'code',
              label: 'Първо посещение',
              value: { kind: 'percent_off', percent: 10 },
              grantId: null,
              code: 'FIRST10',
              exclusive: false,
            },
          ],
          vouchers: [
            { voucherId: 'v1', code: 'GIFT2025', availableMinorUnits: 1000 },
          ],
        }),
      );
      expect(rowValue(saved)).toBe('2 приложени (12,80 €)');
      expect(text(saved, 'staff-visit-total-figure')).toBe('15,20 €');
      expect(saved.hasAttribute('data-dirty')).toBe(false);
      expect(find(saved, 'staff-visit-save')).toBeNull();
      openPage(saved);
      expect(applied(saved)).toEqual([
        'staff-visit-discount-code:FIRST10',
        'staff-visit-voucher-v1',
      ]);
      expect(valueOf(saved, 'staff-visit-discount-code:FIRST10')).toBe('−10%');
      expect(detailOf(saved, 'staff-visit-discount-code:FIRST10')).toBe(
        '−2,80 €',
      );
      expect(valueOf(saved, 'staff-visit-voucher-v1')).toBe('−10,00 €');
      // The page offers nothing of what is on the bill — nothing to offer here.
      expect(offers(saved)).toEqual([]);
      back();

      expect(
        find(
          renderWith(visit({ appointmentId: '', rowId: 'new-1' })),
          'staff-visit-discount-row',
        ),
      ).toBeNull();
      expect(
        find(
          renderWith(visit({ status: 'cancelled', statusLabel: 'Отказан' })),
          'staff-visit-discount-row',
        ),
      ).toBeNull();
    });

    it('keeps the whole bill on one row above «Вид», whatever the kind — folded, and unfolding every line as its ticket', () => {
      const host = renderWith(visit(), {
        uiPromos: PROMOS,
        uiMayDiscount: true,
      });
      openPage(host);
      // The row: A GROUP OF ITS OWN above the «Вид» group (owner: "grouping
      // them doesn't seem right as an Apple HIG guide" — what is applied
      // is content, «Вид» and its door the form) — «Няма» on a clean bill
      // — and asleep: nothing to unfold. Its chevron is the tip row's, not
      // a page's «›».
      const group = find(host, 'staff-visit-discount-lines-group');
      const row = find(
        host,
        'staff-visit-discount-lines-row',
      ) as HTMLButtonElement;
      expect(row.tagName).toBe('BUTTON');
      expect(group?.classList.contains('ui-list-group')).toBe(true);
      expect(group?.children.length).toBe(1);
      expect(group?.children[0]?.contains(row)).toBe(true);
      expect(group?.nextElementSibling?.getAttribute('data-testid')).toBe(
        'staff-visit-discount-add-group',
      );
      expect(
        find(host, 'staff-visit-discount-add-group')?.children.length,
      ).toBe(1);
      expect(
        find(host, 'staff-visit-discount-add-group')?.contains(
          find(host, 'staff-visit-discount-kind'),
        ),
      ).toBe(true);
      expect(text(host, 'staff-visit-discount-lines-value')).toBe('Няма');
      expect(row.disabled).toBe(true);
      expect(row.getAttribute('aria-expanded')).toBe('false');
      expect(row.getAttribute('aria-label')).toBe('Приложени: Няма');
      expect(
        row.querySelector('ui-icon[data-name="field.expand"]'),
      ).not.toBeNull();
      expect(
        row.querySelector('ui-icon[data-name="nav.disclosure"]'),
      ).toBeNull();
      expect(
        find(host, 'staff-visit-discount-lines')?.hasAttribute('inert'),
      ).toBe(true);
      expect(applied(host)).toEqual([]);
      // Right under the page's head (the DS headline since 2026-09-24).
      expect(group?.previousElementSibling?.tagName).toBe('UI-SHEET-HEADLINE');
      expect(
        group?.previousElementSibling?.querySelector('#staff-visit-page-title'),
      ).not.toBeNull();

      // Two lines by two doors — a code from the frame, a percent from the
      // dial: 28,00 − 5,00 = 23,00, then 10% of that, 2,30. The row reads
      // them — "2 отстъпки", the label already says applied — and the
      // group is still the one row: nothing above «Вид» is added, and no
      // ticket stands under the field or the dial: the fold is the one
      // home.
      click(host, 'staff-visit-discount-promo-BEARD5');
      expect(text(host, 'staff-visit-discount-lines-value')).toBe(
        'BEARD5 (5,00 €)',
      );
      expect(row.disabled).toBe(false);
      expect(row.getAttribute('aria-expanded')).toBe('false');
      pickKind(host, 'percent');
      slide(host, 'staff-visit-discount-percent-slider', '10');
      apply(host);
      expect(text(host, 'staff-visit-discount-lines-value')).toBe(
        '2 отстъпки (7,30 €)',
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('20,70 €');
      expect(group?.children.length).toBe(1);
      expect(
        host.querySelectorAll('[data-testid="staff-visit-discount-manual"]')
          .length,
      ).toBe(1);
      expect(
        find(host, 'staff-visit-discount-manual')?.closest(
          '[data-testid="staff-visit-discount-lines"]',
        ),
      ).not.toBeNull();
      // On the sum's door the row is the one sign of both, still folded.
      pickKind(host, 'amount');
      expect(
        find(host, 'staff-visit-discount-lines')?.hasAttribute('inert'),
      ).toBe(true);
      expect(text(host, 'staff-visit-discount-lines-value')).toBe(
        '2 отстъпки (7,30 €)',
      );

      // The tap unfolds THE TICKETS in the row's own segment (owner: "if
      // shown expanded I expect the coupon card, not just list rows"):
      // every line as its card, in the evaluator's order — the code's rule
      // its amount, the percent with what it took off of what was left —
      // «Премахни» on each; no list of rows.
      click(host, 'staff-visit-discount-lines-row');
      expect(row.getAttribute('aria-expanded')).toBe('true');
      const section = find(host, 'staff-visit-discount-lines');
      expect(section?.hasAttribute('inert')).toBe(false);
      expect(section?.closest('.staff-visit__extend')).toBe(
        row.closest('.staff-visit__extend'),
      );
      expect(
        row.closest('.staff-visit__extend')?.hasAttribute('data-open'),
      ).toBe(true);
      expect(applied(host)).toEqual([
        'staff-visit-discount-code:BEARD5',
        'staff-visit-discount-manual',
      ]);
      expect(section?.querySelector('.ui-list-group, .ui-list-row')).toBeNull();
      expect(find(host, 'staff-visit-discount-code:BEARD5')?.tagName).toBe(
        'ARTICLE',
      );
      expect(valueOf(host, 'staff-visit-discount-code:BEARD5')).toBe('−5,00 €');
      expect(text(host, 'staff-visit-discount-code:BEARD5-code')).toBe(
        'BEARD5',
      );
      expect(valueOf(host, 'staff-visit-discount-manual')).toBe('−10%');
      expect(detailOf(host, 'staff-visit-discount-manual')).toBe('−2,30 €');
      expect(text(host, 'staff-visit-remove-discount-manual')).toBe('Премахни');

      // «Премахни» on a ticket takes the line off wherever it came from:
      // the figure goes and the row reads what is left; the code's ticket
      // torn, the row is «Няма» again and FOLDS ITSELF — nothing to hold
      // open — and the card in the frame is on offer.
      click(host, 'staff-visit-remove-discount-manual');
      expect(applied(host)).toEqual(['staff-visit-discount-code:BEARD5']);
      expect(text(host, 'staff-visit-discount-lines-value')).toBe(
        'BEARD5 (5,00 €)',
      );
      expect(text(host, 'staff-visit-total-figure')).toBe('23,00 €');
      expect(row.getAttribute('aria-expanded')).toBe('true');
      click(host, 'staff-visit-remove-discount-code:BEARD5');
      expect(applied(host)).toEqual([]);
      expect(text(host, 'staff-visit-discount-lines-value')).toBe('Няма');
      expect(row.disabled).toBe(true);
      expect(row.getAttribute('aria-expanded')).toBe('false');
      expect(
        find(host, 'staff-visit-discount-lines')?.hasAttribute('inert'),
      ).toBe(true);
      pickKind(host, 'promo');
      expect(stateOf(host, 'staff-visit-discount-promo-BEARD5')).toBe('offer');
      // A line applied after that finds the row folded — it opens on the
      // tap, never on its own; leaving the page folds it, and the root row
      // reads the same bill.
      click(host, 'staff-visit-discount-promo-BEARD5');
      expect(row.getAttribute('aria-expanded')).toBe('false');
      click(host, 'staff-visit-discount-lines-row');
      expect(row.getAttribute('aria-expanded')).toBe('true');
      back();
      expect(rowValue(host)).toBe('BEARD5 (5,00 €)');
      openPage(host);
      expect(
        find(host, 'staff-visit-discount-lines')?.hasAttribute('inert'),
      ).toBe(true);
      expect(text(host, 'staff-visit-discount-lines-value')).toBe(
        'BEARD5 (5,00 €)',
      );
    });
  });

  describe('the duration field', () => {
    const type = (host: HTMLElement, value: string) => {
      const input = find(host, 'staff-visit-duration') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      return input;
    };

    it('takes a duration the old ladder could not offer', () => {
      const host = render();
      // 95 is nowhere near the catalogue's 45-minute span, so no rung held it.
      expect(type(host, '95').value).toBe('95');
      expect(text(host, 'staff-visit-frame-summary')).toContain('11:35');
    });

    it('snaps a typed value onto the five-minute grain', () => {
      const host = render();
      // 47 is not a time this grid can draw; 45 is the nearest that is.
      expect(type(host, '47').value).toBe('45');
    });

    it('refuses to shrink a visit below the floor', () => {
      const host = render();
      // Not a two-minute booking — a typo. Pulled onto the floor rather than
      // written through.
      expect(type(host, '2').value).toBe('5');
    });

    it('leaves the visit alone when the field is cleared', () => {
      const host = render();
      // Clearing and tabbing away is a no-op, never a zero-minute visit.
      expect(type(host, '').value).toBe('45');
    });

    it('lets the services drive the length: a change to them drops a typed one', () => {
      // Owner, 2026-09-09: services first — adding or removing one sets the
      // duration; the barber types over it afterwards if they want to.
      const host = render();
      expect(type(host, '95').value).toBe('95');
      expect(find(host, 'staff-visit-catalog')).not.toBeNull();
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-wash');
      click(host, 'staff-visit-service-apply');
      // 45 of services became 55, and the typed 95 went with the change.
      expect(
        (find(host, 'staff-visit-duration') as HTMLInputElement).value,
      ).toBe('55');
      expect(find(host, 'staff-visit-catalog')).toBeNull();
      expect(text(host, 'staff-visit-frame-summary')).toContain('10:55');
    });
  });

  /*
   * ── CREATING ────────────────────────────────────────────────────────
   *
   * The same sheet, drafting a visit that does not exist yet: an empty
   * appointment id. Nothing to save until there is a service, because a
   * visit without one is not a visit; then the whole draft publishes.
   */
  describe('a new visit', () => {
    const fresh = () =>
      visit({
        appointmentId: '',
        rowId: 'new-1',
        // The dashboard hands a new visit a 30-minute span to draw.
        endMinute: 630,
        legs: [],
        clientLabel: '',
        clientUserId: null,
        phone: null,
        phoneHref: null,
        status: 'new',
        statusLabel: 'Нов час',
        primaryVerb: null,
        priceLabel: null,
      });

    it('has no head — the ＋ already chose — invites a client, and withholds Запази', () => {
      const host = render(fresh());
      expect(find(host, 'staff-visit-state')).toBeNull();
      // Nothing to cancel yet.
      expect(find(host, 'staff-visit-exits')).toBeNull();
      expect(find(host, 'staff-visit-add-client')).not.toBeNull();
      expect(find(host, 'staff-visit-save')).toBeNull();
      // A default span, so the frame has a block to draw and drag.
      expect(
        (find(host, 'staff-visit-duration') as HTMLInputElement).value,
      ).toBe('30');
    });

    it('adds a new client from the dock, with what was typed already in place', () => {
      // «Нов клиент» is always in the dock of the search (owner,
      // 2026-09-09), and a typed number lands in the phone field, a name in
      // the name field. The ✓ seats the person and returns to the ladder.
      const host = render(fresh());
      click(host, 'staff-visit-add-client');
      expect(find(host, 'staff-visit-new-client-dock')).not.toBeNull();
      const query = find(host, 'staff-visit-client-query') as HTMLInputElement;
      query.value = '0888 123 456';
      query.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      click(host, 'staff-visit-new-client-dock');
      expect(find(host, 'staff-visit-page')?.dataset['page']).toBe('clientNew');
      expect(
        (find(host, 'staff-visit-new-name') as HTMLInputElement).value,
      ).toBe('');
      // Nothing to seat without a name.
      expect(
        (find(host, 'staff-visit-new-client-save') as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      const name = find(host, 'staff-visit-new-name') as HTMLInputElement;
      name.value = 'Петър Нов';
      name.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      click(host, 'staff-visit-new-client-save');
      // A person just created has no service: the catalogue opens for
      // them at once (the auto-push flow, 2026-09-24).
      expect(find(host, 'staff-visit-page')?.dataset['page']).toBe('service');
      expect(text(host, 'staff-visit-services-for')).toBe('За Петър Нов');
      back();
      const row = host.querySelector<HTMLElement>(
        '[data-testid^="staff-visit-client-row-guest-"]',
      );
      expect(row?.textContent).toContain('Петър Нов');
      expect(row?.textContent).toContain('+359');
    });

    it('never hands a new guest an id already on the visit', () => {
      // `guest-${length}` re-minted after a removal, and the flow took the
      // third guest for served (found in review, 2026-09-24).
      const host = render(fresh());
      const addGuest = (name: string) => {
        click(host, 'staff-visit-new-client-dock');
        const field = find(host, 'staff-visit-new-name') as HTMLInputElement;
        field.value = name;
        field.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        click(host, 'staff-visit-new-client-save');
        // The catalogue opens for the newcomer; leave it for the next one.
        expect(find(host, 'staff-visit-page')?.dataset['page']).toBe('service');
        back();
      };
      click(host, 'staff-visit-add-client');
      addGuest('Гост Едно');
      click(host, 'staff-visit-add-client');
      addGuest('Гост Две');
      // Untick the first on the search page, then add a third.
      click(host, 'staff-visit-add-client');
      // The picked group's row un-picks on tap.
      const first = host.querySelector<HTMLElement>(
        '[data-testid^="staff-visit-picked-guest-"]',
      );
      expect(first).not.toBeNull();
      first?.click();
      fixture.detectChanges();
      addGuest('Гост Три');
      const ids = [
        ...host.querySelectorAll<HTMLElement>(
          '[data-testid^="staff-visit-client-row-guest-"]',
        ),
      ].map((row) => row.getAttribute('data-testid'));
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      expect(find(host, 'staff-visit-choose-service')).not.toBeNull();
    });

    it('goes back from the form to the search, not to the ladder', () => {
      const host = render(fresh());
      click(host, 'staff-visit-add-client');
      click(host, 'staff-visit-new-client-dock');
      back();
      expect(find(host, 'staff-visit-page')?.dataset['page']).toBe(
        'clientSearch',
      );
      back();
      expect(find(host, 'staff-visit-page')).toBeNull();
    });

    it('changes barber before any service, and seats the service on that chair', () => {
      // Owner, 2026-09-09: on a new visit the chair row re-chaired nothing,
      // because there was no leg yet. The draft carries the chair itself.
      fixture.componentRef.setInput('uiBarbers', [
        { id: 'ivan', label: 'Иван', tone: 0, avatarSrc: null },
        { id: 'stefan', label: 'Стефан', tone: 2, avatarSrc: null },
      ]);
      const host = render(fresh());
      const chairs: string[] = [];
      fixture.componentInstance.chairChanged.subscribe((id) => chairs.push(id));
      click(host, 'staff-visit-barber-ivan');
      click(host, 'staff-visit-barber-pick-stefan');
      expect(chairs.at(-1)).toBe('stefan');
      expect(text(host, 'staff-visit-frame-summary')).toContain('Стефан');
      expect(find(host, 'staff-visit-barber-stefan')).not.toBeNull();

      const commits: { legs: { barberId: string }[] }[] = [];
      fixture.componentInstance.committed.subscribe((c) =>
        commits.push(c as unknown as (typeof commits)[number]),
      );
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-fade');
      click(host, 'staff-visit-service-apply');
      click(host, 'staff-visit-save');
      expect(commits[0]?.legs.map((leg) => leg.barberId)).toEqual(['stefan']);
    });

    it('puts the same service on a visit twice — two rows — and takes one off again', () => {
      // Owner, 2026-09-10: no fold and no counter. Each seat is a row with
      // its own chips; the dropdown marks nothing.
      const host = render(fresh());
      const rows = () =>
        host.querySelectorAll<HTMLElement>(
          'li[data-testid^="staff-visit-leg-"]',
        );
      const seatOf = (index: number) =>
        rows()[index]?.dataset['testid']?.replace('staff-visit-leg-', '') ?? '';

      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-cut:short');
      click(host, 'staff-visit-service-apply');
      expect(rows().length).toBe(1);
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-cut:short');
      click(host, 'staff-visit-service-apply');
      expect(rows().length).toBe(2);
      expect(
        host.querySelector('[data-testid^="staff-visit-leg-count-"]'),
      ).toBeNull();

      // The variant chip re-takes the variant for THIS seat alone.
      click(host, `staff-visit-leg-variant-${seatOf(0)}`);
      pickOpen(host, 'staff-visit-variant-pick-long');
      expect(rows()[0]?.textContent).toContain('Дълга коса');
      expect(rows()[1]?.textContent).toContain('Къса коса');
      const commits: { legs: { serviceId: string; variantId: string }[] }[] =
        [];
      fixture.componentInstance.committed.subscribe((c) =>
        commits.push(c as unknown as (typeof commits)[number]),
      );
      click(host, 'staff-visit-save');
      expect(
        commits[0]?.legs.map((leg) => `${leg.serviceId}@${leg.variantId}`),
      ).toEqual(['cut@long', 'cut@short']);

      // «−» takes one row; the other stays. «−» again, and none.
      click(host, `staff-visit-remove-leg-${seatOf(0)}`);
      expect(rows().length).toBe(1);
      expect(rows()[0]?.textContent).toContain('Къса коса');
      click(host, `staff-visit-remove-leg-${seatOf(0)}`);
      expect(rows().length).toBe(0);
    });
    it('offers Запази once a service is picked, and publishes it', () => {
      const host = render(fresh());
      const commits: { legs: { serviceId: string }[] }[] = [];
      fixture.componentInstance.committed.subscribe((c) =>
        commits.push(c as unknown as { legs: { serviceId: string }[] }),
      );
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-fade');
      click(host, 'staff-visit-service-apply');
      expect(find(host, 'staff-visit-save')).not.toBeNull();
      click(host, 'staff-visit-save');
      expect(commits[0]?.legs.map((leg) => leg.serviceId)).toEqual(['fade']);
    });

    /*
     * ── THE PARTY GRAMMAR ──────────────────────────────────────────────
     *
     * A visit for two is two people with a service each, never one person
     * with a crowd beside them. Every leg names its person; a person
     * without a service withholds Запази and says why; the leg page grows a
     * `За кого` row only once there is a choice to make.
     */
    describe('a party', () => {
      const CLIENTS = [
        {
          id: 'user-martin',
          label: 'Мартин Илиев',
          phone: '+359 88 1',
          meta: null,
        },
        { id: 'user-petar', label: 'Петър Ганев', phone: null, meta: null },
      ];
      const legRow = (host: HTMLElement) =>
        host.querySelector<HTMLElement>(
          '[data-testid^="staff-visit-leg-draft-"]',
        );
      const withTwo = () => {
        const host = render(fresh());
        fixture.componentRef.setInput('uiClients', CLIENTS);
        fixture.detectChanges();
        click(host, 'staff-visit-add-client');
        click(host, 'staff-visit-client-user-martin');
        click(host, 'staff-visit-client-user-petar');
        back();
        return host;
      };

      // THE AUTO-PUSH FLOW (owner, 2026-09-24): the add-client page's ✓
      // asks the party's next question at once — the catalogue, for the
      // person without a service — and hands on to the next one waiting.
      it('confirms the add-client page into the catalogue for each person without a service, seating the picks for them', () => {
        const host = render(fresh());
        fixture.componentRef.setInput('uiClients', CLIENTS);
        fixture.detectChanges();
        click(host, 'staff-visit-add-client');
        click(host, 'staff-visit-client-user-martin');
        click(host, 'staff-visit-client-user-petar');
        click(host, 'staff-visit-page-done');

        expect(find(host, 'staff-visit-page')?.getAttribute('data-page')).toBe(
          'service',
        );
        expect(text(host, 'staff-visit-services-for')).toBe('За Мартин Илиев');
        click(host, 'staff-visit-service-fade');
        click(host, 'staff-visit-service-apply');
        // Петър is still waiting: his catalogue, without a tap.
        expect(text(host, 'staff-visit-services-for')).toBe('За Петър Ганев');
        click(host, 'staff-visit-service-beard');
        click(host, 'staff-visit-service-apply');
        expect(find(host, 'staff-visit-page')).toBeNull();
        expect(find(host, 'staff-visit-choose-service')).toBeNull();

        const commits: { legs: { serviceId: string; clientId: string }[] }[] =
          [];
        fixture.componentInstance.committed.subscribe((c) =>
          commits.push(c as unknown as (typeof commits)[number]),
        );
        click(host, 'staff-visit-save');
        expect(
          commits[0]?.legs.map((leg) => [leg.serviceId, leg.clientId]),
        ).toEqual([
          ['fade', 'user-martin'],
          ['beard', 'user-petar'],
        ]);
      });

      it('asks the first person on a new visit for their service too, and hands a cut picked before anyone was named to them', () => {
        // The ≤1-person guard silenced a new visit's first person (found in
        // review, 2026-09-24): «Нов час» → add Мартин → ✓ opened nothing.
        const host = render(fresh());
        fixture.componentRef.setInput('uiClients', CLIENTS);
        fixture.detectChanges();
        click(host, 'staff-visit-add-client');
        click(host, 'staff-visit-client-user-martin');
        click(host, 'staff-visit-page-done');
        expect(text(host, 'staff-visit-services-for')).toBe('За Мартин Илиев');
        back();
        expect(find(host, 'staff-visit-choose-service')).not.toBeNull();

        // A cut picked BEFORE the first person joined belongs to them:
        // the second person is the one asked.
        const again = render(fresh());
        click(again, 'staff-visit-add-service');
        click(again, 'staff-visit-service-fade');
        click(again, 'staff-visit-service-apply');
        click(again, 'staff-visit-add-client');
        click(again, 'staff-visit-client-user-martin');
        click(again, 'staff-visit-page-done');
        expect(find(again, 'staff-visit-page')).toBeNull();
        click(again, 'staff-visit-add-client');
        click(again, 'staff-visit-client-user-petar');
        click(again, 'staff-visit-page-done');
        expect(text(again, 'staff-visit-services-for')).toBe('За Петър Ганев');
        click(again, 'staff-visit-service-beard');
        click(again, 'staff-visit-service-apply');
        const commits: { legs: { serviceId: string; clientId: string }[] }[] =
          [];
        fixture.componentInstance.committed.subscribe((c) =>
          commits.push(c as unknown as (typeof commits)[number]),
        );
        click(again, 'staff-visit-save');
        expect(
          commits[0]?.legs.map((leg) => [leg.serviceId, leg.clientId]),
        ).toEqual([
          ['fade', 'user-martin'],
          ['beard', 'user-petar'],
        ]);
      });

      it('withholds Запази until everyone has a service, and says so', () => {
        const host = withTwo();
        click(host, 'staff-visit-add-service');
        click(host, 'staff-visit-service-fade');
        click(host, 'staff-visit-service-apply');
        // One service, two people: the second is not served yet.
        expect(find(host, 'staff-visit-save')).toBeNull();
        expect(find(host, 'staff-visit-choose-service')).not.toBeNull();
        // The leg names its person, now that there is more than one.
        expect(legRow(host)?.textContent).toContain('Мартин Илиев');

        click(host, 'staff-visit-add-service');
        click(host, 'staff-visit-service-beard');
        click(host, 'staff-visit-service-apply');
        // Both seeded to the first person — still one unserved.
        expect(find(host, 'staff-visit-save')).toBeNull();

        const commits: { legs: { serviceId: string; clientId: string }[] }[] =
          [];
        fixture.componentInstance.committed.subscribe((c) =>
          commits.push(c as unknown as (typeof commits)[number]),
        );
        // The row's person chip hands the beard to Петър.
        const beard = host.querySelectorAll<HTMLElement>(
          '[data-testid^="staff-visit-leg-draft-"]',
        )[1];
        const chip = beard?.querySelector<HTMLElement>(
          '[data-testid^="staff-visit-leg-person-"]',
        );
        expect(chip?.getAttribute('aria-label')).toContain('Мартин Илиев');
        chip?.click();
        fixture.detectChanges();
        pickOpen(host, 'staff-visit-leg-client-user-petar');

        expect(find(host, 'staff-visit-choose-service')).toBeNull();
        click(host, 'staff-visit-save');
        expect(
          commits[0]?.legs.map((leg) => [leg.serviceId, leg.clientId]),
        ).toEqual([
          ['fade', 'user-martin'],
          ['beard', 'user-petar'],
        ]);
      });

      it('asks WHAT before WHEN, on a new visit and an old one', () => {
        // Owner, 2026-09-09: a barber should not have to remember how long a
        // service takes before placing it — the duration follows from the
        // services and the start came from the tap on the grid. The same
        // order on both, so the sheet reads one way.
        for (const vm of [fresh(), visit()]) {
          const host = render(vm);
          const root = find(host, 'staff-visit-root');
          const services = root?.querySelector('.staff-visit__group--services');
          const frame = find(host, 'staff-visit-frame');
          expect(services).not.toBeNull();
          expect(
            services!.compareDocumentPosition(frame!) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
        }
      });

      it('reopens a saved party as a party: each person a row, each leg named', () => {
        const host = render(
          visit({
            people: [
              {
                id: 'user-martin',
                label: 'Мартин Илиев',
                phone: '+359 88 1',
                phoneHref: 'tel:+359881',
                meta: null,
              },
              {
                id: 'guest-Петър Гост',
                label: 'Петър Гост',
                phone: null,
                phoneHref: null,
                meta: null,
              },
            ],
            legs: [
              {
                seatId: 'seat-cut',
                serviceId: 'cut',
                variantId: null,
                clientId: 'user-martin',
                serviceLabel: 'Подстригване',
                minutes: 30,
                priceLabel: '20,00 €',
                barberId: 'ivan',
                barberName: 'Иван',
                barberTone: 1,
                overridden: false,
              },
              {
                seatId: 'seat-beard',
                serviceId: 'beard',
                variantId: null,
                clientId: 'guest-Петър Гост',
                serviceLabel: 'Оформяне на брада',
                minutes: 15,
                priceLabel: '8,00 €',
                barberId: 'ivan',
                barberName: 'Иван',
                barberTone: 1,
                overridden: false,
              },
            ],
          }),
        );
        expect(
          host.querySelectorAll('[data-testid^="staff-visit-client-row-"]')
            .length,
        ).toBe(2);
        expect(text(host, 'staff-visit-leg-line-seat-cut')).toContain(
          'Мартин Илиев',
        );
        expect(text(host, 'staff-visit-leg-line-seat-beard')).toContain(
          'Петър Гост',
        );
        // Everyone is served, so the party is saveable the moment it changes.
        expect(find(host, 'staff-visit-choose-service')).toBeNull();
      });

      it('draws no За кого for one person, and a person leaving a party takes their services', () => {
        const host = withTwo();
        click(host, 'staff-visit-add-service');
        click(host, 'staff-visit-service-fade');
        click(host, 'staff-visit-service-apply');
        legRow(host)
          ?.querySelector<HTMLElement>(
            '[data-testid^="staff-visit-leg-person-"]',
          )
          ?.click();
        fixture.detectChanges();
        pickOpen(host, 'staff-visit-leg-client-user-petar');
        expect(legRow(host)?.textContent).toContain('Петър Ганев');

        // Петър leaves — a tap on his row in «На посещението» — and his
        // fade leaves WITH him (2026-09-24: one rule for a person leaving;
        // handing his cut to Мартин rewrote a booking without asking).
        click(host, 'staff-visit-add-client');
        click(host, 'staff-visit-picked-user-petar');
        back();
        expect(legRow(host)).toBeNull();
        // Мартин is left with nothing: the dock asks for his service.
        expect(find(host, 'staff-visit-save')).toBeNull();
        expect(find(host, 'staff-visit-choose-service')).not.toBeNull();
      });

      // The owner, 2026-09-24: "having multiple clients should be possible
      // to remove one of them" — the service rows' own «−» and swipe.
      it("takes a party's person off with the row's «−» — with their services — and never the last one", () => {
        const host = render(
          visit({
            people: [
              {
                id: 'user-martin',
                label: 'Мартин Илиев',
                phone: '+359 88 1',
                phoneHref: 'tel:+359881',
                meta: null,
              },
              {
                id: 'guest-son',
                label: 'Синът',
                phone: null,
                phoneHref: null,
                meta: null,
              },
            ],
            legs: [
              {
                seatId: 'seat-cut',
                serviceId: 'cut',
                variantId: null,
                serviceLabel: 'Класическо подстригване',
                minutes: 30,
                priceLabel: '20,00 €',
                barberId: 'ivan',
                barberName: 'Иван',
                barberTone: 0,
                overridden: false,
                clientId: 'user-martin',
              },
              {
                seatId: 'seat-kid',
                serviceId: 'cut',
                variantId: null,
                serviceLabel: 'Класическо подстригване',
                minutes: 30,
                priceLabel: '20,00 €',
                barberId: 'ivan',
                barberName: 'Иван',
                barberTone: 0,
                overridden: false,
                clientId: 'guest-son',
              },
            ],
          }),
        );
        const remove = find(host, 'staff-visit-remove-client-guest-son');
        expect(remove?.getAttribute('aria-label')).toBe('Махни: Синът');
        // The row itself still opens the person's page.
        expect(find(host, 'staff-visit-client-row-guest-son')?.tagName).toBe(
          'BUTTON',
        );
        remove?.click();
        fixture.detectChanges();
        expect(find(host, 'staff-visit-client-row-guest-son')).toBeNull();
        expect(find(host, 'staff-visit-leg-seat-kid')).toBeNull();
        expect(find(host, 'staff-visit-leg-seat-cut')).not.toBeNull();
        // The last person is the visit's: no «−» on Мартин.
        expect(find(host, 'staff-visit-remove-client-user-martin')).toBeNull();

        const commits: { legs: { seatId: string }[] }[] = [];
        fixture.componentInstance.committed.subscribe((c) =>
          commits.push(c as unknown as (typeof commits)[number]),
        );
        click(host, 'staff-visit-save');
        expect(commits[0]?.legs.map((leg) => leg.seatId)).toEqual(['seat-cut']);
      });

      it('never saves a visit with no services left: the dock asks for one instead', () => {
        const host = render();
        // Every service off, one «−» at a time.
        for (;;) {
          const next = host.querySelector<HTMLElement>(
            '[data-testid^="staff-visit-remove-leg-"]',
          );
          if (next === null) break;
          next.click();
          fixture.detectChanges();
        }
        expect(find(host, 'staff-visit-save')).toBeNull();
        expect(find(host, 'staff-visit-choose-service')).not.toBeNull();
        click(host, 'staff-visit-choose-service');
        expect(find(host, 'staff-visit-page')?.getAttribute('data-page')).toBe(
          'service',
        );
      });

      it("names whose share a party chair's cancel calls off", () => {
        const host = render(
          visit({
            overflowVerbs: [
              { kind: 'cancelled', label: 'Откажи', destructive: true },
            ],
            peers: [
              {
                rowId: 'appt#niko',
                clientLabel: 'Стоян Колев',
                chairName: 'Нико',
                chairTone: 1,
                timeLabel: '16:00 – 16:45',
              },
            ],
          }),
        );
        expect(text(host, 'staff-visit-cancel')).toContain(
          'Откажи за Мартин Илиев',
        );
      });
    });
  });

  /*
   * ── THE END, AS A CLOCK ─────────────────────────────────────────────
   * The duration row's title is a choice (owner, 2026-09-09): the same
   * fact, entered as minutes or as an end time. Both write the override.
   */
  describe('the duration row', () => {
    it('offers Край as the other way of saying the same thing', () => {
      const host = render();
      expect(text(host, 'staff-visit-timing-mode')).toContain('Времетраене');
      expect(find(host, 'staff-visit-end')).toBeNull();
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-end');
      expect(text(host, 'staff-visit-timing-mode')).toContain('Край');
      expect(find(host, 'staff-visit-duration')).toBeNull();
      // 10:00 + 45 min, the fixture's derived end.
      expect((find(host, 'staff-visit-end') as HTMLInputElement).value).toBe(
        '10:45',
      );
    });

    it('turns a typed end into a duration, and a past-midnight end into the next day', () => {
      const host = render();
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-end');
      const end = find(host, 'staff-visit-end') as HTMLInputElement;
      end.value = '11:30';
      end.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(text(host, 'staff-visit-frame-summary')).toContain('11:30');
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-duration');
      expect(
        (find(host, 'staff-visit-duration') as HTMLInputElement).value,
      ).toBe('90');

      // Start 10:00, end typed 00:15 → tomorrow: 14 h 15 min = 855.
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-end');
      const again = find(host, 'staff-visit-end') as HTMLInputElement;
      again.value = '00:15';
      again.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      click(host, 'staff-visit-timing-mode');
      click(host, 'staff-visit-timing-duration');
      expect(
        (find(host, 'staff-visit-duration') as HTMLInputElement).value,
      ).toBe('855');
    });
  });

  /*
   * ── AFTER THE CUT, AND DURING IT ───────────────────────────────────────
   * Owner, 2026-09-09: a 10:00 cut at 09:55 read «Минал» (seed data), and a
   * finished visit could not be corrected. A finished visit is EDITABLE —
   * the sheet gets filled in after the cut; a cancelled one is not. And a
   * visit inside its own window, unstamped, is «В момента».
   */
  describe('a finished visit', () => {
    it('is still editable — rows, frame and services', () => {
      const host = render(visit({ status: 'completed', statusLabel: 'Минал' }));
      expect(find(host, 'staff-visit-remove-leg-seat-cut')).not.toBeNull();
      expect(find(host, 'staff-visit-add-service')).not.toBeNull();
      expect(find(host, 'staff-visit-duration')).not.toBeNull();
      // …the head says nothing, and the next visit is on offer at the foot.
      expect(find(host, 'staff-visit-state')).toBeNull();
      expect(
        find(host, 'staff-visit-rebook')?.closest(
          '[data-testid="staff-visit-exits"]',
        ),
      ).not.toBeNull();
    });

    it('locks a cancelled one — nothing happened, nothing to correct', () => {
      const host = render(
        visit({ status: 'cancelled', statusLabel: 'Отказан' }),
      );
      expect(find(host, 'staff-visit-remove-leg-seat-cut')).toBeNull();
      expect(find(host, 'staff-visit-add-service')).toBeNull();
      expect(find(host, 'staff-visit-duration')).toBeNull();
    });
  });

  /*
   * ── THE SERVICE PAGE'S VARIANT ROW AND CATALOGUE READOUT (2026-09-09) ──
   */
  describe('money and length, after the service page', () => {
    it('keeps the bill to the discount and the tip — no seat lines, whoever the user is', () => {
      // Owner, 2026-09-16: "the price and service row should be removed
      // from there" — the ladder already names every seat and the dock
      // already sums them; a second list of the same names with a figure
      // each was one number twice. Repricing moves to the service page
      // when it exists, so the sheet takes no `uiMayReprice` any more.
      const host = render();
      expect(text(host, 'staff-visit-leg-line-seat-cut')).toBe('30 мин');
      const money = find(host, 'staff-visit-money');
      expect(money).not.toBeNull();
      expect(
        money?.querySelector('[data-testid^="staff-visit-price-row-"]'),
      ).toBeNull();
      expect(
        money?.querySelector('[data-testid^="staff-visit-leg-price-"]'),
      ).toBeNull();
      expect(money?.querySelector('ui-unit-field')).toBeNull();
      expect(
        [...(money?.querySelectorAll('li') ?? [])].map((row) =>
          row.querySelector('[data-testid]')?.getAttribute('data-testid'),
        ),
      ).toEqual(['staff-visit-discount-row', 'staff-visit-tip']);
      // A seat added in this draft is a row on the ladder and nothing on
      // the bill.
      click(host, 'staff-visit-add-service');
      click(host, 'staff-visit-service-wash');
      click(host, 'staff-visit-service-apply');
      expect(
        host.querySelector('[data-testid^="staff-visit-leg-draft-"]'),
      ).not.toBeNull();
      expect(
        money?.querySelector('[data-testid^="staff-visit-price-row-"]'),
      ).toBeNull();
    });

    it('reads out the catalogue total and the distance when the visit is shortened', () => {
      const host = render();
      expect(find(host, 'staff-visit-catalog')).toBeNull();
      const field = find(host, 'staff-visit-duration') as HTMLInputElement;
      field.value = '35';
      field.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(text(host, 'staff-visit-catalog')).toBe(
        'Каталог: 45 мин · −10 мин',
      );
      expect(text(host, 'staff-grid-tag')).toBe('−10 мин');
    });
  });

  it('replaces the add-note row with the textarea, in place', () => {
    const host = render();

    // At rest the group is one row, and the row says what it is — which is
    // why there is no heading over it.
    expect(text(host, 'staff-visit-add-note')).toBe('Добави бележка');
    expect(find(host, 'staff-visit-note-field')).toBeNull();

    click(host, 'staff-visit-add-note');

    const field = find(host, 'staff-visit-note-field');
    expect(field?.tagName).toBe('TEXTAREA');
    // The button BECAME the field: it is not still sitting above it.
    expect(find(host, 'staff-visit-add-note')).toBeNull();

    // And the client's own words are a quotation outside every group —
    // never merged with the team's note, never a control — and ATTRIBUTED,
    // so nobody mistakes them for the shop's (owner review 2026-09-08).
    const quote = find(host, 'staff-visit-client-note');
    expect(quote?.querySelector('blockquote')?.textContent?.trim()).toBe(
      'Закъснявам 5 минути.',
    );
    expect(quote?.querySelector('figcaption')?.textContent?.trim()).toBe(
      'От клиента',
    );
    expect(quote?.closest('.ui-list-group')).toBeNull();
  });

  describe('full screen', () => {
    it('lifts the frame to full screen and back, and Escape leaves it without reaching the sheet', () => {
      // Owner, 2026-09-10; HIG: an expand control top-trailing, the same
      // control flipped to leave, and always an obvious way out.
      const host = render();
      const frame = find(host, 'staff-visit-frame');
      const toggle = find(host, 'staff-visit-frame-expand');
      expect(frame?.hasAttribute('data-expanded')).toBe(false);
      expect(toggle?.getAttribute('aria-label')).toBe('На цял екран');

      // Either way through, the block is centred again in the picture's
      // new height (owner, 2026-09-10: "on exit the event should be
      // scrolled to, centred") — instantly, under the view transition.
      const grid = fixture.debugElement.query(By.directive(StaffTimeGrid))
        .componentInstance as StaffTimeGrid;
      const recentred = vi.spyOn(grid, 'recenter');

      click(host, 'staff-visit-frame-expand');
      expect(frame?.hasAttribute('data-expanded')).toBe(true);
      // The whole screen: a manual popover while expanded, so the top
      // layer positions it against the viewport, not the sheet's surface.
      expect(frame?.getAttribute('popover')).toBe('manual');
      expect(toggle?.getAttribute('aria-label')).toBe('Изход от цял екран');
      expect(toggle?.getAttribute('aria-pressed')).toBe('true');
      expect(recentred).toHaveBeenCalledWith('auto');
      recentred.mockClear();

      // Escape inside the frame closes FULL SCREEN, and nothing above it
      // hears the key — the sheet must not take it as "close".
      let reached = 0;
      host.addEventListener('keydown', () => (reached += 1));
      toggle?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();
      expect(frame?.hasAttribute('data-expanded')).toBe(false);
      expect(frame?.hasAttribute('popover')).toBe(false);
      expect(reached).toBe(0);
      expect(recentred).toHaveBeenCalledWith('auto');

      // Not expanded: Escape is the sheet's, as before.
      toggle?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      expect(reached).toBe(1);
    });
  });

  /*
   * ── THE HEAD OF A SETTLED CHAIR (owner, 2026-09-11) ──────────────────
   * "The cancellation reason or no-show is not showing in the event detail
   * sheets." A settled chair opens on the fact that settled it — whose act,
   * when, and why — where a request's head would sit; a live one has no
   * such head, and a reason nobody gave is silence rather than "no reason".
   */
  describe('the head of a settled chair', () => {
    const head = (host: HTMLElement) =>
      host.querySelector('[data-testid="staff-visit-resolution"]');
    const part = (host: HTMLElement, id: string) =>
      host
        .querySelector(`[data-testid="staff-visit-resolution-${id}"]`)
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? null;

    it("says who called it off, when, and why — in the sheet's one red", () => {
      const host = render(
        visit({
          status: 'cancelled',
          statusLabel: 'Отказан',
          resolution: {
            kind: 'cancelled',
            by: 'client',
            whenLabel: '24.08, 18:40',
            detail: 'Не вдига телефона',
          },
        }),
      );
      expect(head(host)?.getAttribute('data-tone')).toBe('destructive');
      expect(part(host, 'line')).toBe(
        'staff.visit.resolution.cancelledByClient · 24.08, 18:40',
      );
      expect(part(host, 'detail')).toBe('Не вдига телефона');
      // Two rows: the stylesheet keys the glyph's span on it.
      expect(head(host)?.hasAttribute('data-detail')).toBe(true);
    });

    it("reads a no-show as nobody's act, in warning ink, with no reason line", () => {
      const host = render(
        visit({
          status: 'no_show',
          statusLabel: 'Пропуснат',
          resolution: {
            kind: 'no_show',
            by: null,
            whenLabel: '10:15',
            detail: null,
          },
        }),
      );
      expect(head(host)?.getAttribute('data-tone')).toBe('warning');
      expect(part(host, 'line')).toBe('staff.visit.resolution.noShow · 10:15');
      expect(part(host, 'detail')).toBeNull();
      // One row, so the glyph centres on the one line rather than on a
      // line and an empty track's gap.
      expect(head(host)?.hasAttribute('data-detail')).toBe(false);
    });

    it('has nothing to say on a live visit', () => {
      expect(head(render())).toBeNull();
    });
  });

  /*
   * ── THE FRAME'S NEIGHBOURS (owner, 2026-09-11) ────────────────────────
   * Context recedes and the subject does not: a neighbour is a block that is
   * only drawn, and the paint keys on `inert`. Its `past` mark is a fact the
   * drag guards read, and it used to be stamped on every neighbour whatever
   * the clock said.
   */
  describe("the frame's neighbours", () => {
    const neighbour = (host: HTMLElement) =>
      host.querySelector('[data-event-id="neighbour-0"]');

    it('are drawn inert beside the one editable block', () => {
      const host = render();
      expect(neighbour(host)?.hasAttribute('inert')).toBe(true);
      expect(neighbour(host)?.hasAttribute('data-editable')).toBe(false);
      expect(
        host.querySelector('[data-editable]')?.getAttribute('data-event-id'),
      ).toBe('appointment-1');
    });

    it('are marked past only once their hour has gone', () => {
      // Мартин 09:00 – 09:50; the clock decides.
      expect(
        neighbour(render(visit({ nowMinute: 560 })))?.hasAttribute('data-past'),
      ).toBe(false);
      expect(
        neighbour(render(visit({ nowMinute: 600 })))?.hasAttribute('data-past'),
      ).toBe(true);
      // On another day there is no clock, and nothing has gone.
      expect(
        neighbour(render(visit({ nowMinute: null })))?.hasAttribute(
          'data-past',
        ),
      ).toBe(false);
    });
  });
});
