import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, Length, ValidateNested } from 'class-validator';
import { Language, Scene } from './providers';

export class LanguageDto {
  @IsIn(['en', 'ja']) language!: Language;
}
export class MessageDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @Length(1, 2000) text!: string;
}
export class TurnDto extends LanguageDto {
  @IsIn(['interview', 'daily']) scene!: Scene;
  @IsString() @Length(1, 2000) text!: string;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => MessageDto)
  history!: MessageDto[];
}
export class SynthesizeDto extends LanguageDto {
  @IsString() @Length(1, 2000) text!: string;
}
