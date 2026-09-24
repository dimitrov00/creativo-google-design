import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { UiAvatar } from '../avatar/avatar';
import { UiAvatarGroup } from './avatar-group';

@Component({
  imports: [UiAvatar, UiAvatarGroup],
  template: `
    <ui-avatar-group
      uiControlSize="small"
      [uiOverflow]="overflow"
      aria-label="Бръснар: Иван Колев, Клиент: Георги Петров"
    >
      <ui-avatar uiControlSize="small" uiName="Иван Колев" />
      <ui-avatar uiControlSize="small" uiName="Георги Петров" />
    </ui-avatar-group>
  `,
})
class Host {
  overflow = 0;
}

async function render(overflow: number) {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.overflow = overflow;
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector(
    'ui-avatar-group',
  );
}

describe('UiAvatarGroup', () => {
  it('is one mark to assistive tech — a named group of projected avatars, nothing more while everyone is shown', async () => {
    const group = await render(0);
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe(
      'Бръснар: Иван Колев, Клиент: Георги Петров',
    );
    expect(group?.getAttribute('data-control-size')).toBe('small');
    expect(group?.querySelectorAll(':scope > ui-avatar').length).toBe(2);
    expect(group?.querySelector('.ui-avatar-group__more')).toBeNull();
  });

  it('counts the people it does not show, as decoration', async () => {
    TestBed.resetTestingModule();
    const group = await render(3);
    const more = group?.querySelector('.ui-avatar-group__more');
    expect(more?.textContent?.trim()).toBe('+3');
    expect(more?.getAttribute('aria-hidden')).toBe('true');
  });
});
