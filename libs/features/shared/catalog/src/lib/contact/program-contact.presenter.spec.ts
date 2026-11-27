import { contactRowVm, opensNewTab } from './program-contact.presenter';

const INSTAGRAM = 'https://instagram.com/creativo.barbershop';

describe('contactRowVm', () => {
  it('makes the only way the row’s own link', () => {
    expect(
      contactRowVm(
        [{ contactMethod: 'PHONE', contactValue: '+359888123456' }],
        INSTAGRAM,
      ),
    ).toEqual({
      contacts: [{ contactMethod: 'PHONE', href: 'tel:+359888123456' }],
      only: { contactMethod: 'PHONE', href: 'tel:+359888123456' },
    });
  });

  it('names no single way when there are several, in the stored order', () => {
    const row = contactRowVm(
      [
        { contactMethod: 'EMAIL', contactValue: 'jobs@creativo.test' },
        { contactMethod: 'PHONE', contactValue: '+359888123456' },
      ],
      INSTAGRAM,
    );

    expect(row.only).toBeNull();
    expect(row.contacts.map((link) => link.href)).toEqual([
      'mailto:jobs@creativo.test',
      'tel:+359888123456',
    ]);
  });

  it('answers through the shop’s Instagram for a program with no way of its own', () => {
    expect(contactRowVm([], INSTAGRAM).only).toEqual({
      contactMethod: 'INSTAGRAM',
      href: INSTAGRAM,
    });
  });
});

describe('opensNewTab', () => {
  it('opens a web address beside the page, and hands a call or a mail to the device', () => {
    expect(
      (['PHONE', 'EMAIL', 'INSTAGRAM', 'LINK'] as const).map((contactMethod) =>
        opensNewTab({ contactMethod, href: 'x' }),
      ),
    ).toEqual([false, false, true, true]);
  });
});
