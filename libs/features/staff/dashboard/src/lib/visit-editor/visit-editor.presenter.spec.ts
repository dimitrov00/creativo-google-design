import { describe, expect, it } from 'vitest';
import { ArrivalVerb, CancelledSide, PlacementVerdict } from '@core/components';
import {
  BarberId,
  BookingStatus,
  CustomerId,
  DraftPersonKey,
  DurationMinutes,
  SeatId,
  ServiceId,
  ServiceVariantId,
  TrackMinute,
  UserId,
} from '@core/primitives';
import { unwrapOk } from '@core/testing';
import { catalogueWords } from '../testing/visit-editor-words';
import type { VisitEditorServiceOption } from './staff-visit-editor';
import {
  callName,
  clientLineOf,
  clockLabel,
  dayRelatives,
  editorPageTitleOf,
  frameSummaryOf,
  frameVerdictVm,
  type LegFacts,
  type LegRowsInput,
  legRowsVm,
  peerLine,
  photoDoors,
  removeClientName,
  resolutionHeadOf,
  serviceApplyVm,
  serviceOptionLine,
  servicePersonOf,
  sheetTitleOf,
  shopReadoutOf,
  shopRowName,
  shopViews,
  timingOptions,
  visitExitsVm,
  chairOptionsOf,
  leftOffNoticeOf,
  photoPersonOf,
} from './visit-editor.presenter';
import { EditorPage } from './visit-editor.vm';

/*
 * THE VISIT SHEET'S WORDS, in both languages, from the app's real catalogue
 * and fixed values. Building `BG` and `EN` is itself a test: a key the words
 * name and either catalogue lacks throws here. Legality and arithmetic are the
 * systems', pinned there.
 */

const BG = catalogueWords('bg');
const EN = catalogueWords('en');

const track = (raw: number) => TrackMinute.ofProven(raw);
const mins = (raw: number) => unwrapOk(DurationMinutes.of(raw));

describe('the words', () => {
  it('fill a figure, and the holes the sheet has always filled by hand', () => {
    expect(BG.minutes(30)).toBe('30 мин');
    expect(EN.minutes(30)).toBe('30 min');
    expect(BG.catalogMinutes(45)).toBe('Каталог: 45 мин');
    expect(BG.sameAsLast('4 септември')).toBe(
      'Взехме услугите от 4 септември.',
    );
    expect(BG.tipRoundUp('15,00 €')).toBe('общо 15,00 €');
    expect(EN.tipRoundUp('€15.00')).toBe('€15.00 in total');
    expect(BG.voucherLeft('10,00 €')).toBe('остават 10,00 €');
    expect(EN.discountHasGrant('X')).toBe('Coupon available: X');
    expect(BG.newClientParts('Мария')).toBe('Нов клиент: Мария');
  });
});

describe('the clock', () => {
  it('writes a minute on the 24-hour face, a late one wrapping onto the next day', () => {
    expect(clockLabel(track(605))).toBe('10:05');
    expect(clockLabel(track(1440))).toBe('00:00');
    expect(clockLabel(track(1455))).toBe('00:15');
  });
});

describe('the pop-ups’ options', () => {
  it('keep their ids and test ids in either language', () => {
    expect(
      timingOptions(BG).map((option) => [
        option.id,
        option.label,
        option.testId,
      ]),
    ).toEqual([
      ['DURATION', 'Времетраене', 'staff-visit-timing-duration'],
      ['END', 'Край', 'staff-visit-timing-end'],
    ]);
    expect(
      shopViews(EN).map((view) => [view.id, view.label, view.icon]),
    ).toEqual([
      ['map', 'Map', 'view.map'],
      ['list', 'List', 'view.list'],
    ]);
    expect(dayRelatives(BG)).toEqual([
      { offset: 0, label: 'Днес' },
      { offset: 1, label: 'Утре' },
    ]);
  });

  it('offer the camera only where the engine has one', () => {
    expect(photoDoors(BG, false).map((door) => door.id)).toEqual([
      'UPLOAD',
      'SYSTEM',
    ]);
    expect(
      photoDoors(BG, true).map((door) => [door.id, door.label, door.icon]),
    ).toEqual([
      ['CAMERA', 'Снимай', 'media.camera'],
      ['UPLOAD', 'От устройството', 'media.library'],
      ['SYSTEM', 'От галерията', 'media.gallery'],
    ]);
  });
});

describe('the «Салон» row', () => {
  it('reads the shop, or a dash for one no longer listed', () => {
    const shop = {
      label: 'Център',
    } as Parameters<typeof shopReadoutOf>[0];
    expect(shopReadoutOf(shop, BG)).toBe('Център');
    expect(shopReadoutOf(null, EN)).toBe('—');
    expect(shopRowName('Център', BG)).toBe('Салон: Център');
    expect(shopRowName('Center', EN)).toBe('Shop: Center');
  });
});

describe('the frame’s narration', () => {
  const base = {
    startLabel: '10:00',
    endLabel: '10:45',
    durationMinutes: mins(45),
    chairName: 'Иван',
    rosterStartMinute: track(540),
    rosterEndMinute: track(1080),
    neighbours: [
      { name: 'Мария', startMinute: track(660), endMinute: track(690) },
      { name: 'Петър', startMinute: track(720), endMinute: track(750) },
    ],
    words: BG,
  };

  it('carries both boundaries, the chair, the shift and every neighbour', () => {
    expect(frameSummaryOf(base)).toBe(
      '10:00 – 10:45, 45 мин · Иван · 09:00 – 18:00 · Мария 11:00 – 11:30, Петър 12:00 – 12:30',
    );
  });

  it('leaves an empty run out, in either language', () => {
    expect(frameSummaryOf({ ...base, neighbours: [], words: EN })).toBe(
      '10:00 – 10:45, 45 min · Иван · 09:00 – 18:00',
    );
  });
});

describe('the line under the frame', () => {
  const clash = {
    name: 'Мария',
    startMinute: track(660),
    endMinute: track(690),
  };
  const shift = { startMinute: track(540) };

  it('names the neighbour run into, with its hours', () => {
    expect(frameVerdictVm(PlacementVerdict.Overlap, clash, shift)).toEqual({
      placementVerdict: PlacementVerdict.Overlap,
      name: 'Мария',
      start: '11:00',
      end: '11:30',
    });
  });

  it('says when the shift opens', () => {
    expect(frameVerdictVm(PlacementVerdict.Outside, undefined, shift)).toEqual({
      placementVerdict: PlacementVerdict.Outside,
      time: '09:00',
    });
  });

  it('is silent without a verdict, or without its subject', () => {
    expect(frameVerdictVm(null, clash, shift)).toBeNull();
    expect(
      frameVerdictVm(PlacementVerdict.Overlap, undefined, shift),
    ).toBeNull();
    expect(frameVerdictVm(PlacementVerdict.Outside, clash, null)).toBeNull();
  });
});

describe('the services’ rows', () => {
  const MARTIN = DraftPersonKey.of('guest-martin');
  const GEORGI = DraftPersonKey.of('guest-georgi');
  const CUT = ServiceId.of('cut');
  const LONG = ServiceVariantId.of('long');

  const leg = (partial: Partial<LegFacts> = {}): LegFacts => ({
    seatId: SeatId.of('seat-1'),
    serviceId: CUT,
    variantId: null,
    clientId: MARTIN,
    serviceLabel: 'Подстригване (записано)',
    durationMinutes: mins(30),
    barberName: 'Иван',
    overridden: false,
    ...partial,
  });
  const plainCut = {
    id: 'cut',
    serviceId: CUT,
    variantId: null,
    label: 'Подстригване',
    serviceLabel: 'Подстригване',
    variantLabel: null,
    minutes: mins(30),
    priceLabel: '20,00 €',
  } as VisitEditorServiceOption;
  const longCut = {
    id: 'cut:long',
    serviceId: CUT,
    variantId: LONG,
    label: 'Подстригване · Дълга коса',
    serviceLabel: 'Подстригване',
    variantLabel: 'Дълга коса',
    minutes: mins(45),
    priceLabel: '28,00 €',
  } as VisitEditorServiceOption;

  const input = (partial: Partial<LegRowsInput> = {}): LegRowsInput => ({
    legs: [leg()],
    durationOverride: null,
    clients: [{ id: MARTIN, label: 'Мартин' }],
    services: [plainCut, longCut],
    chairName: 'Иван',
    storedSeats: new Set<SeatId>(),
    words: BG,
    ...partial,
  });

  const only = (partial: Partial<LegRowsInput> = {}) => {
    const [row] = legRowsVm(input(partial));
    if (row === undefined) throw new Error('no row');
    return row;
  };

  it('says which seats the server holds, as it is told (BUG-1, BUG-2)', () => {
    expect(only().stored).toBe(false);
    expect(only({ storedSeats: new Set([leg().seatId]) }).stored).toBe(true);
  });

  it('titles a seat by the catalogue’s service, bare, and says nothing twice', () => {
    const row = only();
    expect(row.service).toBe('Подстригване');
    expect(row.serviceLabel).toBe('Подстригване (записано)');
    expect(row.line).toBe('');
    expect(row.removeName).toBe('Премахни услугата: Подстригване');
  });

  it('falls back to the seat’s own label for a retired service', () => {
    const row = only({ services: [] });
    expect(row.service).toBe('Подстригване (записано)');
    expect(row.removeName).toBe('Премахни услугата: Подстригване (записано)');
    expect(row.variantChoices).toEqual([]);
    expect(row.variantKey).toBeNull();
    expect(row.variantName).toBe('Вариант: —');
  });

  it('leads the line with the variant, and names it joined when spoken', () => {
    const row = only({ legs: [leg({ variantId: LONG })] });
    expect(row.line).toBe('Дълга коса');
    expect(row.variantKey).toBe('cut:long');
    expect(row.variantName).toBe('Вариант: Дълга коса');
    expect(row.removeName).toBe('Премахни услугата: Подстригване · Дълга коса');
    expect(row.variantChoices).toEqual([
      {
        id: 'cut:long',
        label: 'Дълга коса',
        testId: 'staff-visit-variant-pick-long',
      },
    ]);
  });

  it('prints minutes only when the frame does not already say them', () => {
    const two = [leg(), leg({ seatId: SeatId.of('seat-2') })];
    expect(legRowsVm(input({ legs: two }))[0]?.line).toBe('30 мин');
    expect(
      legRowsVm(input({ legs: two, durationOverride: mins(45) }))[0]?.line,
    ).toBe('');
    expect(legRowsVm(input({ legs: two, words: EN }))[0]?.line).toBe('30 min');
  });

  it('names another chair’s barber, whose seat on a party, and a term agreed', () => {
    const clients = [
      { id: MARTIN, label: 'Мартин' },
      { id: GEORGI, label: 'Георги' },
    ];
    const row = only({
      clients,
      legs: [leg({ clientId: GEORGI, barberName: 'Никола', overridden: true })],
    });
    expect(row.line).toBe('Никола · Георги · по договорка');
    expect(row.clientLabel).toBe('Георги');
    expect(row.forWhomName).toBe('За кого: Георги');
    expect(only({ words: EN, legs: [leg({ overridden: true })] }).line).toBe(
      'as agreed',
    );
  });

  it('reads a catalogue row with whatever it has', () => {
    expect(serviceOptionLine(longCut, BG)).toBe(
      'Дълга коса · 45 мин · 28,00 €',
    );
    expect(serviceOptionLine(plainCut, EN)).toBe('30 min · 20,00 €');
    expect(serviceOptionLine({ ...plainCut, priceLabel: null }, EN)).toBe(
      '30 min',
    );
  });

  it('promises the picks, or nothing', () => {
    expect(serviceApplyVm(0, BG)).toBeNull();
    expect(serviceApplyVm(1, BG)).toEqual({ count: 1, label: 'Добави' });
    expect(serviceApplyVm(3, BG)).toEqual({
      count: 3,
      label: 'Добави 3 услуги',
    });
    expect(serviceApplyVm(3, EN)?.label).toBe('Add 3 services');
  });

  it('finds the person a catalogue page is for', () => {
    const clients = [{ id: MARTIN, label: 'Мартин' }];
    expect(servicePersonOf(clients, 'guest-martin')).toBe('Мартин');
    expect(servicePersonOf(clients, 'nobody')).toBeNull();
  });
});

describe('the bar', () => {
  const base = { pageTitle: null, isNew: false, clients: [], words: BG };

  it('titles the sheet by a page, a new visit, the walk-in or the person', () => {
    expect(sheetTitleOf({ ...base, pageTitle: 'Снимай' })).toBe('Снимай');
    expect(sheetTitleOf({ ...base, isNew: true })).toBe('Нов час');
    expect(sheetTitleOf(base)).toBe('Случаен клиент');
    expect(sheetTitleOf({ ...base, words: EN })).toBe('Walk-in');
    expect(sheetTitleOf({ ...base, clients: [{ label: 'Мартин' }] })).toBe(
      'Мартин',
    );
    expect(
      sheetTitleOf({
        ...base,
        clients: [{ label: 'Мартин' }, { label: 'Георги' }],
      }),
    ).toBe('Мартин +1');
  });

  const title = (
    editorPage: EditorPage,
    partial: {
      clientName?: string | null;
      photoTitle?: string | null;
      cardTitle?: string | null;
    } = {},
    words = BG,
  ) =>
    editorPageTitleOf({
      editorPage,
      clientName: partial.clientName ?? null,
      photoTitle: partial.photoTitle ?? null,
      cardTitle: partial.cardTitle ?? null,
      words,
    });

  it.each([
    [EditorPage.ClientSearch, 'Добави клиент', 'Add a client'],
    [EditorPage.ClientNew, 'Нов клиент', 'New client'],
    [EditorPage.Service, 'Добави услуга', 'Add a service'],
    [EditorPage.Discount, 'Отстъпка', 'Discount'],
    [EditorPage.Scan, 'Сканирай код', 'Scan a code'],
    [EditorPage.Photo, 'Снимка', 'Photo'],
    [EditorPage.Camera, 'Снимай', 'Take a photo'],
    [EditorPage.Library, 'От галерията', 'From the gallery'],
    [EditorPage.ClientLoyalty, 'Лоялност', 'Loyalty'],
    [EditorPage.ClientLedger, 'Движение', 'Activity'],
    [EditorPage.ClientRecords, 'Рекорди', 'Records'],
    [EditorPage.ClientHistory, 'Посещения', 'Visits'],
    [EditorPage.ClientAchievements, 'Постижения', 'Achievements'],
    [EditorPage.AchievementCategory, 'Постижения', 'Achievements'],
    [EditorPage.AchievementDetail, 'Постижения', 'Achievements'],
  ])('names %s before the card has spoken', (page, bg, en) => {
    expect(title(page)).toBe(bg);
    expect(title(page, {}, EN)).toBe(en);
  });

  it('prefers what the card and the photo know', () => {
    expect(title(EditorPage.Client, { clientName: 'Мартин' })).toBe('Мартин');
    expect(title(EditorPage.Client)).toBeNull();
    expect(title(EditorPage.Photo, { photoTitle: '4.09' })).toBe('4.09');
    expect(title(EditorPage.Photo, { photoTitle: '' })).toBe('');
    expect(title(EditorPage.ClientLoyalty, { cardTitle: 'Х' })).toBe('Х');
  });
});

describe('the head of a settled chair', () => {
  const when = { whenLabel: '14:32', detail: null };

  it('reads nothing on a live chair', () => {
    expect(resolutionHeadOf(null)).toBeNull();
  });

  it('keeps the sheet’s one red for a cancellation, by whose act it was', () => {
    expect(
      resolutionHeadOf({
        ...when,
        bookingStatus: BookingStatus.Cancelled,
        by: CancelledSide.Client,
      }),
    ).toEqual({
      word: 'cancelledByClient',
      tone: 'destructive',
      icon: 'visit.cancelled',
    });
    expect(
      resolutionHeadOf({
        ...when,
        bookingStatus: BookingStatus.Cancelled,
        by: CancelledSide.Shop,
      }),
    ).toEqual({
      word: 'cancelledByStaff',
      tone: 'destructive',
      icon: 'visit.cancelled',
    });
  });

  it('warns on a no-show, nobody’s act', () => {
    expect(
      resolutionHeadOf({
        ...when,
        bookingStatus: BookingStatus.NoShow,
        by: null,
      }),
    ).toEqual({ word: 'noShow', tone: 'warning', icon: 'visit.noShow' });
  });
});

describe('the exits', () => {
  const verb = (
    rowVerb: Parameters<typeof visitExitsVm>[0]['verbs'][number]['rowVerb'],
    label: string,
    destructive = false,
  ) => ({ rowVerb, label, destructive });
  const base = {
    bookingStatus: BookingStatus.Confirmed,
    verbs: [
      verb(ArrivalVerb.Arrived, 'Дойде'),
      verb(BookingStatus.NoShow, 'Не дойде'),
      verb(BookingStatus.Cancelled, 'Откажи', true),
    ],
    started: true,
    peerCount: 0,
    clients: [{ label: 'Мартин' }],
    words: BG,
  };

  it('leaves the stamps out, offers the no-show once started, cancel last', () => {
    expect(
      visitExitsVm(base).map((exit) => [
        exit.id,
        exit.label,
        exit.icon,
        exit.destructive,
        exit.act,
      ]),
    ).toEqual([
      ['no-show', 'Не дойде', 'visit.noShow', false, BookingStatus.NoShow],
      [
        'cancel',
        'Откажи часа',
        'visit.cancelled',
        true,
        BookingStatus.Cancelled,
      ],
      [
        'cancel-block',
        'Откажи и блокирай времето',
        'booking.blocked',
        true,
        null,
      ],
    ]);
  });

  it('says whose share a party’s cancel calls off', () => {
    expect(
      visitExitsVm({ ...base, peerCount: 1 }).find(
        (exit) => exit.id === 'cancel',
      )?.label,
    ).toBe('Откажи за Мартин');
    expect(
      visitExitsVm({ ...base, peerCount: 1, clients: [] }).find(
        (exit) => exit.id === 'cancel',
      )?.label,
    ).toBe('Откажи часа');
    expect(
      visitExitsVm({ ...base, peerCount: 1, words: EN }).find(
        (exit) => exit.id === 'cancel',
      )?.label,
    ).toBe('Cancel for Мартин');
  });

  it('offers the next visit after a finished one, by the system’s answer', () => {
    const exits = visitExitsVm({
      ...base,
      bookingStatus: BookingStatus.Completed,
      verbs: [],
    });
    expect(exits.map((exit) => exit.id)).toEqual(['rebook']);
    expect(exits[0]?.label).toBe('Запиши пак');
    expect(exits[0]?.icon).toBe('appointment.book');
  });

  it('takes a no-show back as reinstate', () => {
    const exits = visitExitsVm({
      ...base,
      bookingStatus: BookingStatus.NoShow,
      verbs: [verb(BookingStatus.Confirmed, 'Върни')],
    });
    expect(exits[0]).toMatchObject({
      id: 'reinstate',
      label: 'Върни',
      icon: 'visit.confirmed',
      act: BookingStatus.Confirmed,
    });
  });
});

describe('the people’s lines', () => {
  it('keeps the last visit, or says there is no number to call', () => {
    expect(clientLineOf({ meta: 'посл. 22.09', phone: '+359' }, BG)).toBe(
      'посл. 22.09',
    );
    expect(clientLineOf({ meta: 'посл. 22.09', phone: null }, BG)).toBe(
      'посл. 22.09 · Няма номер',
    );
    expect(clientLineOf({ meta: null, phone: null }, EN)).toBe('No number');
    expect(clientLineOf({ meta: null, phone: '+359' }, BG)).toBe('');
  });

  it('speaks the controls', () => {
    expect(removeClientName('Мартин', BG)).toBe('Махни от посещението: Мартин');
    expect(removeClientName('Martin', EN)).toBe('Remove from visit: Martin');
    expect(callName('Мартин', BG)).toBe('Обади се — Мартин');
    expect(callName('Martin', EN)).toBe('Call — Martin');
  });

  it('reads a peer chair', () => {
    expect(
      peerLine({
        rowId: 'a#b',
        clientLabel: 'Георги',
        chairName: 'Иван',
        chairTone: 0,
        timeLabel: '16:00 – 16:30',
      }),
    ).toBe('Иван · 16:00 – 16:30');
  });
});

describe('chairOptionsOf — every barber a visit knows about', () => {
  const IVAN = BarberId.of('ivan');
  const NIKO = BarberId.of('niko');
  const chair = { chairId: IVAN, chairName: 'Иван', chairTone: 1 };
  const legOn = (barberId: BarberId | null, barberName: string) => ({
    barberId,
    barberName,
    barberTone: 1,
  });

  it('is the roster when one is bound', () => {
    const options = chairOptionsOf({
      ...chair,
      roster: [{ id: NIKO, label: 'Нико', tone: 2, avatarSrc: '/niko.jpg' }],
      legs: [legOn(IVAN, 'Иван')],
    });
    expect(options).toEqual([
      { key: NIKO, id: NIKO, name: 'Нико', tone: 2, avatarSrc: '/niko.jpg' },
    ]);
  });

  it('lists the chair once when a leg sits on it, roster-less (BUG-4)', () => {
    const options = chairOptionsOf({
      ...chair,
      roster: [],
      legs: [legOn(IVAN, 'Иван')],
    });
    expect(options.map((option) => option.id)).toEqual([IVAN]);
  });

  it('adds the chair when no leg sits on it, roster-less', () => {
    const options = chairOptionsOf({
      ...chair,
      roster: [],
      legs: [legOn(NIKO, 'Нико')],
    });
    expect(options.map((option) => option.id)).toEqual([NIKO, IVAN]);
    expect(options[1]?.key).toBe('Иван');
  });

  it('lists the chair alone with no legs, and a chairless leg’s row beside it', () => {
    expect(
      chairOptionsOf({ ...chair, roster: [], legs: [] }).map(
        (option) => option.id,
      ),
    ).toEqual([IVAN]);
    expect(
      chairOptionsOf({
        ...chair,
        chairId: null,
        roster: [],
        legs: [legOn(null, 'Иван')],
      }).map((option) => option.key),
    ).toEqual(['']);
  });
});

describe('photoPersonOf — the person a photo names, by id (BUG-9)', () => {
  const A = DraftPersonKey.account(UserId.of('user-a'));
  const B = DraftPersonKey.account(UserId.of('user-b'));
  const GUEST = DraftPersonKey.guest('Ани');
  const RECORD_B = CustomerId.of('customer-b');
  const clients = [
    { id: A, customerId: CustomerId.of('customer-a') },
    { id: B, customerId: RECORD_B },
    { id: GUEST },
  ];
  const noOwner = { clientCustomerId: null, clientUserId: null };
  const photo = (
    clientCustomerId: CustomerId | null,
    clientLabel = 'Иван',
  ) => ({
    clientCustomerId,
    clientLabel,
  });

  it('finds the record’s person, whatever the label', () => {
    expect(photoPersonOf(photo(RECORD_B), clients, noOwner)?.id).toBe(B);
  });

  it('reads the visit’s own record as its account holder', () => {
    const own = CustomerId.of('customer-own');
    expect(
      photoPersonOf(photo(own), [{ id: A }], {
        clientCustomerId: own,
        clientUserId: UserId.of('user-a'),
      })?.id,
    ).toBe(A);
  });

  it('answers nobody for a record no one on the visit holds', () => {
    expect(
      photoPersonOf(photo(CustomerId.of('customer-z')), clients, {
        clientCustomerId: null,
        clientUserId: UserId.of('user-a'),
      }),
    ).toBeNull();
  });

  it('knows a guest with no record by the key his label makes', () => {
    expect(photoPersonOf(photo(null, 'Ани'), clients, noOwner)?.id).toBe(GUEST);
  });

  it('reads no record on a visit of no record as its account holder', () => {
    expect(
      photoPersonOf(photo(null), clients, {
        clientCustomerId: null,
        clientUserId: UserId.of('user-b'),
      })?.id,
    ).toBe(B);
    expect(photoPersonOf(photo(null), clients, noOwner)).toBeNull();
  });

  it('holds no person for an account no longer on the visit', () => {
    expect(
      photoPersonOf(photo(null), [], {
        clientCustomerId: null,
        clientUserId: UserId.of('user-a'),
      }),
    ).toBeNull();
  });
});

describe('leftOffNoticeOf — the line a rebooked draft’s missing service earns', () => {
  const gone = (serviceLabel: string, id = 'svc-gone') => ({
    serviceId: ServiceId.of(id),
    serviceLabel,
  });

  it('says nothing when nothing was left off', () => {
    expect(leftOffNoticeOf([], BG)).toBeNull();
    expect(leftOffNoticeOf([], EN)).toBeNull();
  });

  it('names the service, in «ти» and in English', () => {
    expect(leftOffNoticeOf([gone('Брада')], BG)).toBe(
      'Вече не е в каталога: Брада. Избери друга услуга.',
    );
    expect(leftOffNoticeOf([gone('Beard')], EN)).toBe(
      'No longer in the catalogue: Beard. Pick another service.',
    );
  });

  it('names each one it can', () => {
    expect(leftOffNoticeOf([gone('Брада'), gone('Фейд', 'svc-2')], BG)).toBe(
      'Вече не е в каталога: Брада, Фейд. Избери друга услуга.',
    );
    expect(leftOffNoticeOf([gone('Брада'), gone('svc-2', 'svc-2')], BG)).toBe(
      'Вече не е в каталога: Брада. Избери друга услуга.',
    );
  });

  it('prints no raw id: with no name at hand it says so plainly', () => {
    expect(leftOffNoticeOf([gone('svc-gone')], BG)).toBe(
      'Услуга от това посещение вече не е в каталога. Избери друга.',
    );
    expect(leftOffNoticeOf([gone('svc-gone')], EN)).toBe(
      'A service from this visit is no longer in the catalogue. Pick another.',
    );
  });
});
