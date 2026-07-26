import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiListGroup } from './list-group';
import { UiListRow } from '../list-row/list-row';

@Component({
  imports: [UiListGroup, UiListRow],
  template: `
    <ui-list-group data-testid="group">
      <a uiListRow href="#one" [uiInteractive]="true">One</a>
      <a uiListRow href="#two" [uiInteractive]="true">Two</a>
    </ui-list-group>
    <ul uiListGroup data-testid="semantic-group">
      <li uiListRow>Alpha</li>
      <li uiListRow>Beta</li>
    </ul>
  `,
})
class HostComponent {}

describe('UiListGroup', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('stamps the host class and projects rows as direct children', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="group"]',
    );
    expect(el.classList.contains('ui-list-group')).toBe(true);
    const rows = el.querySelectorAll(':scope > .ui-list-row');
    expect(rows.length).toBe(2);
  });

  it('attaches to semantic lists via ul[uiListGroup] with li rows', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="semantic-group"]',
    );
    expect(el.tagName).toBe('UL');
    expect(el.classList.contains('ui-list-group')).toBe(true);
    expect(el.querySelectorAll(':scope > li.ui-list-row').length).toBe(2);
  });
});
