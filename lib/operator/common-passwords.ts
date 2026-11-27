/**
 * Vanliga och läckta lösenord (operatörskonton, 2026-10-30): a short offline list of the passwords and base words
 * that top every published list of leaked passwords, in English and Swedish. The project has no other password list and
 * no leak service is asked (no external call); the rules in rules.ts also refuse sequences, one repeated character and
 * a base word from this list with only a year or a few digits after it ("sommar2026", "Password1!").
 */
export const COMMON_PASSWORDS: readonly string[] = [
  "password", "passw0rd", "p@ssw0rd", "p@ssword", "pass1234", "password1", "password12", "password123", "letmein", "welcome",
  "welcome1", "admin", "admin123", "administrator", "root", "toor", "login", "master", "secret", "changeme", "default",
  "qwerty", "qwertyui", "qwertyuiop", "qwerty123", "asdfghjk", "asdfghjkl", "zxcvbnm", "zxcvbnm1", "1q2w3e4r", "1q2w3e4r5t",
  "q1w2e3r4", "1qaz2wsx", "zaq12wsx", "abc12345", "abcd1234", "abcdefgh", "iloveyou", "sunshine", "princess", "football",
  "baseball", "dragon", "monkey", "shadow", "superman", "batman", "trustno1", "starwars", "whatever", "freedom", "michael",
  "jennifer", "computer", "internet", "corvette", "mercedes", "hello123", "hellohello", "11111111", "12341234", "12121212",
  "123123123", "1234567890", "0987654321", "87654321", "123456789", "12345678", "00000000", "88888888", "99999999",
  "123qweasd", "qweasdzxc", "access", "access14", "mustang", "jordan23", "killer", "charlie", "pokemon", "minecraft",
  "summer", "winter", "spring", "autumn", "operator", "operator1", "terminal", "maskin", "maskin1", "fabriken", "verkstad",
  "lösenord", "losenord", "losen", "lösen", "sommar", "vinter", "hösten", "hosten", "våren", "varen", "hejhej", "hejsan",
  "hejsan123", "sverige", "stockholm", "göteborg", "goteborg", "malmö", "malmo", "uppsala", "kalle", "kalleanka", "anka",
  "katten", "hunden", "fotboll", "hockey", "volvo", "saab", "scania", "ikea", "kärlek", "karlek", "bajskorv", "abc123",
  "test", "test1234", "testtest", "guest", "user", "user1234", "service", "support", "workflow", "hintek", "felanmälan",
  "felanmalan", "underhåll", "underhall", "linje", "press", "avdelning", "montering",
];

const LIST = new Set(COMMON_PASSWORDS.map((item) => item.toLowerCase()));
export const isCommonWord = (value: string) => LIST.has(value.toLowerCase());
