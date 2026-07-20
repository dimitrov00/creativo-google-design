import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  CursorDotComponent,
  CursorTargetDirective,
} from '@creativo/shared/cursor';
import { ThemeToggle } from '@creativo/shared/ui';

@Component({
  selector: 'cr-root',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    ThemeToggle,
    CursorDotComponent,
    CursorTargetDirective,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
