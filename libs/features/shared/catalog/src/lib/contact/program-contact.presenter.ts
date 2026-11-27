import {
  ContactMethod,
  type ContactLink,
  type ProgramContact,
} from '@core/components';
import { ProgramsSystem } from '@core/systems';
import type { ContactRowVm } from './program-contact.vm';

/*
 * A PROGRAM'S WAYS TO ANSWER, FOR A ROW (Law 10). It decides nothing: which
 * ways there are, their addresses and the stand-in for a program with none
 * are `ProgramsSystem.contactLinks`'. This only shapes them for a row — one
 * way is the row's own link, several open the sheet.
 */

/** The row's answer for a program's stored contacts. */
export function contactRowVm(
  contacts: readonly ProgramContact[],
  instagramUrl: string,
): ContactRowVm {
  const links = ProgramsSystem.contactLinks(contacts, instagramUrl);
  const [first] = links;
  return {
    contacts: links,
    only: links.length === 1 && first !== undefined ? first : null,
  };
}

/** A web address opens beside the page; a call or a mail is handed to the device. */
export function opensNewTab(link: ContactLink): boolean {
  return (
    link.contactMethod === ContactMethod.Instagram ||
    link.contactMethod === ContactMethod.Link
  );
}
