import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Structural placeholder shell (Phase 0: workspace alignment) — theme
// init, session-expiry guard, and impersonation banner land with the
// app-shell pass (goal-05).
@Component({
  selector: 'cr-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
