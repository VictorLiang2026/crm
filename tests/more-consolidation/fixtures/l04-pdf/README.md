# Fictional PDF fixtures

These files were generated locally with PDFKit 0.17.2, only as test fixture tooling (not an application dependency).

- encrypted.pdf: text “Fictional encrypted record”, user password `fixture-only`, owner password `fixture-owner`.
- no-text.pdf: a filled grey rectangle and no text, representing a page without extractable text.
- chinese.pdf: self-authored ASCII PDF with Unicode mapping and a predefined CJK font reference; text “系统测试虚构人物职业工程师”. No font file is embedded or redistributed.

The test creates ordinary, multi-page, mixed blank/text and boundary-size PDFs itself. It contains no customer data. PDFKit/its dependencies are not deployed.
