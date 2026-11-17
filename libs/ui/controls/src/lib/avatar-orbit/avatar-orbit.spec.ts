import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiAvatarOrbit, type UiAvatarOrbitFace } from './avatar-orbit';

const face = (id: string, name: string): UiAvatarOrbitFace => ({
  id,
  name,
  avatarSrc: null,
});

const TEAM = [
  face('b-1', 'Иван Колев'),
  face('b-2', 'Нико Нинов'),
  face('b-3', 'Мартин Петров'),
  face('b-4', 'Елена Георгиева'),
  face('b-5', 'Георги Иванов'),
  face('b-6', 'Стефан Димов'),
  face('b-7', 'Калина Тодорова'),
  face('b-8', 'Борис Николов'),
];

@Component({
  imports: [UiAvatarOrbit],
  template: `
    <ui-avatar-orbit
      [uiCenter]="center"
      [uiFaces]="faces()"
      aria-label="Петър Петров и екипът"
    />
  `,
})
class Host {
  readonly center = face('b-own', 'Петър Петров');
  readonly faces = signal<readonly UiAvatarOrbitFace[]>([]);
}

async function render(faces: readonly UiAvatarOrbitFace[]) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.faces.set(faces);
  fixture.detectChanges();
  const orbit = (fixture.nativeElement as HTMLElement).querySelector(
    'ui-avatar-orbit',
  ) as HTMLElement;
  const seats = Array.from(
    orbit.querySelectorAll<HTMLElement>('.ui-avatar-orbit__seat'),
  );
  return { orbit, seats };
}

describe('UiAvatarOrbit', () => {
  it('is one picture to assistive tech, the centre face and the orbits decoration', async () => {
    const { orbit } = await render(TEAM.slice(0, 2));
    expect(orbit.getAttribute('role')).toBe('img');
    expect(orbit.getAttribute('aria-label')).toBe('Петър Петров и екипът');
    const center = orbit.querySelector('.ui-avatar-orbit__center');
    expect(center?.getAttribute('data-control-size')).toBe('extraLarge');
    expect(center?.getAttribute('aria-hidden')).toBe('true');
    expect(
      orbit
        .querySelector('.ui-avatar-orbit__ring')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('seats the faces in order, the first three larger on the inner orbit', async () => {
    const { seats } = await render(TEAM.slice(0, 5));
    expect(seats.map((seat) => seat.getAttribute('data-seat'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(seats.map((seat) => seat.getAttribute('data-control-size'))).toEqual(
      ['large', 'large', 'large', 'regular', 'regular'],
    );
    expect(document.querySelector('.ui-avatar-orbit__more')).toBeNull();
  });

  it('seats six as six, and past six five faces and the count in the last seat', async () => {
    const six = await render(TEAM.slice(0, 6));
    expect(six.seats).toHaveLength(6);
    expect(six.orbit.querySelector('.ui-avatar-orbit__more')).toBeNull();

    const eight = await render(TEAM);
    expect(eight.seats).toHaveLength(6);
    const more = eight.orbit.querySelector('.ui-avatar-orbit__more');
    expect(more?.textContent?.trim()).toBe('+3');
    expect(more?.getAttribute('data-seat')).toBe('6');
  });

  it('alone, draws the centre and the orbits with no seat', async () => {
    const { orbit, seats } = await render([]);
    expect(seats).toHaveLength(0);
    expect(orbit.querySelector('.ui-avatar-orbit__center')).not.toBeNull();
    expect(orbit.querySelector('.ui-avatar-orbit__paths')).not.toBeNull();
  });
});
