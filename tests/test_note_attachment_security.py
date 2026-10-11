import pytest
from api.workspace import NoteIn, validate_note_attachment


@pytest.mark.parametrize('data,mime', [
    ('javascript:alert(1)', 'application/pdf'),
    ('https://example.test/file', 'application/pdf'),
    ('data:text/html;base64,PHNjcmlwdD4=', 'text/html'),
    ('data:application/pdf;base64,JVBERg==', 'image/png'),
    ('data:application/pdf;base64,!', 'application/pdf'),
    ('data:application/pdf;base64,YQ', 'application/pdf'),
])
def test_unsafe_attachment_rejected(data, mime):
    with pytest.raises(ValueError):
        NoteIn(title='Synthetic', attachment_data=data, attachment_type=mime)


def test_document_and_drawing_boundaries():
    validate_note_attachment('data:application/pdf;base64,JVBERg==', 'application/pdf')
    validate_note_attachment('data:image/png;base64,YQ==', 'image/png', 'drawing')
    with pytest.raises(ValueError):
        validate_note_attachment('data:application/pdf;base64,JVBERg==', 'application/pdf', 'drawing')
