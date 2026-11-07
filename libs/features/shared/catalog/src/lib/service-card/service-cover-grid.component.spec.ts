import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ServiceId } from '@core/primitives';
import { beforeEach, describe, expect, it } from 'vitest';
import { coverRowsOf, type ServiceCoverTile } from './service-cover-grid';
import { ServiceCoverGridComponent } from './service-cover-grid.component';

type Tile = ServiceCoverTile & { readonly mine: string };

const tile = (id: string, checked: boolean, variant = false): Tile => ({
  id,
  serviceId: ServiceId.of(id.split(':')[0] ?? id),
  name: id,
  meta: variant ? 'Дълга коса' : '',
  coverSrc: null,
  checked,
  testId: `picker-${id}`,
  mine: `own-${id}`,
});

@Component({
  imports: [ServiceCoverGridComponent],
  template: `
    <cr-service-cover-grid
      uiGridTestId="picker-grid"
      [uiGrids]="grids()"
      (uiPicked)="picked.push($event)"
    />
  `,
})
class HostComponent {
  readonly grids = signal(
    coverRowsOf(
      [tile('fade', true), tile('beard', false), tile('cut:long', false, true)],
      (t) => t.serviceId,
      (t) => t.meta !== '',
    ),
  );
  readonly picked: Tile[] = [];
}

describe('ServiceCoverGridComponent — the shared service picker grid', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  it('lays each grid out as cover cards, ticking the checked and naming each card', () => {
    const grids = host.querySelectorAll('[data-testid="picker-grid"]');
    expect([...grids].map((grid) => grid.getAttribute('data-service'))).toEqual(
      ['PLAIN:0', 'cut'],
    );
    const cards = [...host.querySelectorAll('cr-service-card')];
    expect(cards.map((card) => card.getAttribute('data-tile'))).toEqual([
      'fade',
      'beard',
      'cut:long',
    ]);
    expect(cards.map((card) => card.hasAttribute('data-checked'))).toEqual([
      true,
      false,
      false,
    ]);
    expect(cards[0]?.getAttribute('data-testid')).toBe('picker-fade');
  });

  it('hands the pressed tile back whole, the picker’s own fields with it', () => {
    host
      .querySelector<HTMLElement>('cr-service-card[data-tile="beard"] button')
      ?.click();
    expect(fixture.componentInstance.picked.map((t) => t.mine)).toEqual([
      'own-beard',
    ]);
  });

  it('never takes the focus from a field being typed in', () => {
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    host.querySelector('cr-service-card')?.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });
});
